"""Local deterministic worker for reconstructed B1/B2 tasks only."""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import socket
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from quant_trading.config import settings
from quant_trading.core.database import SessionLocal
from quant_trading.models.recovery import (
    Artifact,
    DataQualityRun,
    DataSource,
    Dataset,
    DatasetVersion,
    Run,
    Task,
    utcnow,
)
from quant_trading.services.recovery import content_hash
from quant_trading.services.snapshot_store import SnapshotStore, SnapshotStoreError
from quant_trading.services.task_queue import LeaseToken, TaskQueue


logger = logging.getLogger(__name__)
_QUALITY_NAMESPACE = uuid.UUID("a53156af-d006-4ccf-b308-e61fe84169f0")
_SHANGHAI = ZoneInfo("Asia/Shanghai")
_FIXTURE_ROW_LIMIT = 1_000_000


class QualityGateBlocked(RuntimeError):
    """A deterministic fixture deliberately rejected by its local gate."""


class LostLease(RuntimeError):
    """The task's ownership fence was replaced or expired."""


class Worker:
    """Process one DB-leased local task at a time without external effects."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session] = SessionLocal,
        worker_id: str | None = None,
        artifact_root: str | None = None,
        data_root: str | None = None,
        lease_seconds: int | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.worker_id = worker_id or f"local-{socket.gethostname()}-{os.getpid()}-{uuid.uuid4()}"
        self.lease_seconds = lease_seconds or settings.TASK_LEASE_SECONDS
        self.store = SnapshotStore(
            artifact_root=artifact_root or settings.ARTIFACT_ROOT,
            data_root=data_root or settings.DATA_ROOT,
        )
        self.running = False

    @staticmethod
    def _extension_for(artifact_format: str) -> str:
        return {"json": "json", "parquet": "parquet", "html": "html", "markdown": "md", "text": "txt"}.get(
            artifact_format,
            "json",
        )

    def _artifact(
        self,
        db: Session,
        *,
        task: Task,
        artifact_type: str,
        value: dict[str, Any] | None = None,
        binary_data: bytes | None = None,
        artifact_format: str = "json",
        storage_kind: str = "artifact",
        row_count: int | None = None,
        run_id: str | None = None,
        logical_sha256: str | None = None,
    ) -> Artifact:
        """Write and validate a stable task artifact before persisting metadata."""

        if (value is None) == (binary_data is None):
            raise ValueError("artifact needs exactly one content form")
        extension = self._extension_for(artifact_format)
        if binary_data is None:
            assert value is not None
            stored = self.store.write_task_json(task_id=task.id, artifact_type=artifact_type, value=value)
            expected_bytes = stored.content.encode("utf-8")
            calculated_logical = content_hash(value)
        else:
            stored = self.store.write_task_binary(
                task_id=task.id,
                artifact_type=artifact_type,
                extension=extension,
                data=binary_data,
            )
            expected_bytes = binary_data
            calculated_logical = content_hash({"sha256": stored.sha256, "size_bytes": stored.size_bytes})
        if stored.artifact_id != self.store.artifact_id(task_id=task.id, artifact_type=artifact_type):
            raise SnapshotStoreError("managed artifact identity is invalid")
        existing = db.scalar(
            select(Artifact).where(
                Artifact.task_id == task.id,
                Artifact.artifact_type == artifact_type,
            )
        )
        if existing is not None:
            actual = self.store.read_task_artifact(
                task_id=task.id,
                artifact_type=artifact_type,
                extension=extension,
            )
            if (
                existing.id != stored.artifact_id
                or existing.format != artifact_format
                or existing.storage_kind != storage_kind
                or existing.sha256 != stored.sha256
                or existing.size_bytes != stored.size_bytes
                or existing.content != stored.content
                or actual != expected_bytes
            ):
                raise SnapshotStoreError("managed artifact integrity check failed")
            return existing
        artifact = Artifact(
            id=stored.artifact_id,
            task_id=task.id,
            run_id=run_id,
            artifact_type=artifact_type,
            format=artifact_format,
            storage_kind=storage_kind,
            size_bytes=stored.size_bytes,
            sha256=stored.sha256,
            logical_content_sha256=logical_sha256 or calculated_logical,
            row_count=row_count,
            content=stored.content,
            generated_by_task_id=task.id,
        )
        db.add(artifact)
        db.flush()
        return artifact

    @staticmethod
    def _quality_result(*, passed: bool, count: int, message: str) -> dict[str, Any]:
        return {
            "rule_id": "deterministic_fixture_gate",
            "rule_version": "reconstructed-b2-v1",
            "severity": "blocking",
            "status": "passed" if passed else "failed",
            "count": count,
            "message": message,
            "samples": [],
        }

    @staticmethod
    def _quality_id(task_id: str) -> str:
        return str(uuid.uuid5(_QUALITY_NAMESPACE, f"{task_id}:quality-run"))

    @staticmethod
    def _fixture_rows(version: DatasetVersion) -> list[dict[str, Any]]:
        """Generate deterministic daily bars with Shanghai-local UTC semantics."""

        start, end = date.fromisoformat(version.time_start), date.fromisoformat(version.time_end)
        rows: list[dict[str, Any]] = []
        current = start
        symbols = sorted({str(value) for value in version.symbols if str(value)}) or ["FIXTURE"]
        expected = ((end - start).days + 1) * len(symbols)
        if expected < 1 or expected > _FIXTURE_ROW_LIMIT:
            raise ValueError("deterministic fixture row limit exceeded")
        while current <= end:
            for symbol_index, symbol in enumerate(symbols):
                day_index = (current - start).days
                base = Decimal("10.000000") + Decimal(day_index) / Decimal("10") + Decimal(symbol_index)
                event_local = datetime.combine(current, time(15, 0), tzinfo=_SHANGHAI)
                available_local = datetime.combine(current, time(16, 0), tzinfo=_SHANGHAI)
                rows.append(
                    {
                        "symbol": symbol,
                        "exchange": "SSE",
                        "event_time": event_local.astimezone(timezone.utc),
                        "open": base - Decimal("0.010000"),
                        "high": base + Decimal("0.020000"),
                        "low": base - Decimal("0.020000"),
                        "close": base + Decimal("0.005000"),
                        "volume": 1000 + day_index * 10 + symbol_index,
                        "available_at": available_local.astimezone(timezone.utc),
                        "ingested_at": available_local.astimezone(timezone.utc) + timedelta(minutes=5),
                        "source_revision": "deterministic-fixture-v1",
                    }
                )
            current += timedelta(days=1)
        return rows

    def _quality_run(self, db: Session, *, task: Task, version: DatasetVersion) -> DataQualityRun:
        quality = db.get(DataQualityRun, self._quality_id(task.id))
        if quality is None:
            quality = DataQualityRun(
                id=self._quality_id(task.id),
                version_id=version.id,
                task_id=task.id,
                rule_set_version="reconstructed-b2-v1",
                status="running",
                results=[],
            )
            db.add(quality)
            db.flush()
        return quality

    def _ingest(self, db: Session, task: Task) -> None:
        payload = task.payload or {}
        version = db.get(DatasetVersion, payload.get("dataset_version_id"))
        if version is None:
            raise ValueError("referenced dataset version is unavailable")
        dataset = db.get(Dataset, version.dataset_id)
        source = db.get(DataSource, version.data_source_id) if version.data_source_id else None
        if dataset is None or source is None or source.adapter != "deterministic_fixture":
            raise ValueError("only deterministic fixture data sources are supported")

        quality = self._quality_run(db, task=task, version=version)
        if source.name == "Deterministic fixture (blocked)":
            result = self._quality_result(
                passed=False,
                count=1,
                message="Deterministic fixture is configured to fail the local quality gate",
            )
            quality.status = "blocked"
            quality.blocking_count = 1
            quality.warning_count = 0
            quality.results = [result]
            quality.completed_at = utcnow()
            report = self._artifact(
                db,
                task=task,
                artifact_type="data_quality_report",
                value={"version_id": version.id, "status": "blocked", "results": [result]},
            )
            quality.report_artifact_id = report.id
            self.store.remove_snapshot(dataset_id=dataset.id, version_id=version.id)
            version.status = "failed"
            version.quality_status = "blocked"
            version.quality_summary = {"summary": "blocked: deterministic fixture gate"}
            version.manifest = None
            version.manifest_sha256 = None
            version.parent_version_id = None
            raise QualityGateBlocked("deterministic quality gate blocked the fixture")

        result = self._quality_result(
            passed=True,
            count=0,
            message="Deterministic fixture passed the reconstructed local quality gate",
        )
        quality.status = "passed"
        quality.blocking_count = 0
        quality.warning_count = 0
        quality.results = [result]
        quality.completed_at = utcnow()
        report = self._artifact(
            db,
            task=task,
            artifact_type="data_quality_report",
            value={"version_id": version.id, "status": "passed", "results": [result]},
        )
        quality.report_artifact_id = report.id
        manifest_base = {
            "manifest_version": "dataset_manifest_v1",
            "schema_version": "market_bar_v1",
            "schema_fingerprint": "",  # SnapshotStore replaces with actual Arrow schema bytes hash.
            "dataset_id": dataset.id,
            "dataset_version_id": version.id,
            "parent_version_id": version.parent_version_id,
            "source": {
                "name": source.name,
                "revision": "deterministic-fixture-v1",
                "license_ref": dataset.license,
            },
            "market": dataset.market,
            "frequency": dataset.frequency,
            "timezone": "Asia/Shanghai",
            "adjustment": version.adjustment,
            "primary_key": ["symbol", "exchange", "event_time"],
            "sort_key": ["event_time", "symbol", "exchange"],
            "time_range": {"start": version.time_start, "end": version.time_end},
            "writer_profile": {},  # SnapshotStore inserts the actual writer profile.
            "generation": {
                "task_id": task.id,
                "code_version": "reconstructed-b2-v1",
                "config_hash": content_hash(
                    {
                        "symbols": sorted(version.symbols),
                        "time_start": version.time_start,
                        "time_end": version.time_end,
                        "timezone": version.timezone,
                        "adjustment": version.adjustment,
                    }
                ),
            },
            "quality": {
                "rule_set": quality.rule_set_version,
                "status": "passed",
                "run_id": quality.id,
                "report_artifact_id": report.id,
                "report_relative_path": self.store.artifact_relative_path(
                    task_id=task.id,
                    artifact_type="data_quality_report",
                    extension="json",
                ),
                "report_sha256": report.sha256,
            },
            "logical_content_sha256": version.logical_content_sha256
            or content_hash({"dataset_version_id": version.id, "symbols": sorted(version.symbols)}),
        }
        snapshot = self.store.materialize_snapshot(
            dataset_id=dataset.id,
            version_id=version.id,
            rows=self._fixture_rows(version),
            manifest_base=manifest_base,
        )
        partition_bytes = self.store.read_snapshot_partition(
            dataset_id=dataset.id,
            version_id=version.id,
            manifest=snapshot.manifest,
        )
        version.status = "available"
        version.quality_status = "passed"
        version.quality_summary = {"summary": "passed: deterministic fixture gate"}
        version.row_count = snapshot.row_count
        version.manifest = snapshot.manifest
        version.manifest_sha256 = snapshot.manifest_sha256
        version.logical_content_sha256 = snapshot.manifest["logical_content_sha256"]
        partition = snapshot.manifest["partitions"][0]
        self._artifact(
            db,
            task=task,
            artifact_type="dataset_partition",
            binary_data=partition_bytes,
            artifact_format="parquet",
            storage_kind="data",
            row_count=snapshot.row_count,
            logical_sha256=content_hash(partition),
        )
        self._artifact(
            db,
            task=task,
            artifact_type="dataset_manifest",
            value=snapshot.manifest,
            row_count=snapshot.row_count,
            logical_sha256=content_hash(snapshot.manifest),
        )

    def _quality(self, db: Session, task: Task) -> None:
        payload = task.payload or {}
        version = db.get(DatasetVersion, payload.get("dataset_version_id"))
        if version is None:
            raise ValueError("referenced dataset version is unavailable")
        quality_id = payload.get("quality_run_id")
        quality = db.get(DataQualityRun, quality_id) if quality_id else self._quality_run(db, task=task, version=version)
        if quality is None:
            raise ValueError("referenced quality run is unavailable")
        passed = version.status == "available" and version.quality_status == "passed"
        result = self._quality_result(
            passed=passed,
            count=0 if passed else 1,
            message="Available snapshot check passed" if passed else "Dataset version is not an available clean snapshot",
        )
        quality.status = "passed" if passed else "blocked"
        quality.blocking_count = 0 if passed else 1
        quality.warning_count = 0
        quality.results = [result]
        quality.completed_at = utcnow()
        report = self._artifact(
            db,
            task=task,
            artifact_type="data_quality_report",
            value={"version_id": version.id, "status": quality.status, "results": [result]},
        )
        quality.report_artifact_id = report.id
        if not passed:
            raise QualityGateBlocked("dataset version is not an available clean snapshot")

    def _backtest(self, db: Session, task: Task) -> None:
        run = db.get(Run, task.run_id or (task.payload or {}).get("run_id"))
        if run is None:
            raise ValueError("referenced run is unavailable")
        run.status = "running"
        run.started_at = run.started_at or utcnow()
        self._artifact(
            db,
            task=task,
            run_id=run.id,
            artifact_type="run_manifest",
            value={
                "run_id": run.id,
                "mode": "deterministic_local_no_market_backtest",
                "protocol": run.run_manifest,
            },
        )
        run.metrics = {}
        run.business_result_sha256 = content_hash(
            {"run_manifest_sha256": run.run_manifest_sha256, "deterministic": True}
        )
        run.status = "success"
        run.result_completeness = "complete"
        run.completed_at = utcnow()

    def _diagnostic(self, db: Session, task: Task) -> None:
        self._artifact(
            db,
            task=task,
            artifact_type="task_result",
            value={"task_id": task.id, "task_type": "diagnostic", "payload": task.payload or {}},
        )

    def _execute(self, db: Session, task: Task) -> None:
        if task.task_type == "data_ingest":
            self._ingest(db, task)
        elif task.task_type == "data_quality":
            self._quality(db, task)
        elif task.task_type == "backtest":
            self._backtest(db, task)
        elif task.task_type == "diagnostic":
            self._diagnostic(db, task)
        else:
            raise ValueError("unsupported task type")

    def _mark_validating(self, db: Session, task: Task) -> None:
        if task.task_type != "data_ingest":
            return
        version = db.get(DatasetVersion, (task.payload or {}).get("dataset_version_id"))
        if version is None:
            raise ValueError("referenced dataset version is unavailable")
        if version.status not in {"draft", "validating"}:
            raise ValueError("dataset version is not pending deterministic ingestion")
        version.status = "validating"
        version.quality_status = "pending"
        version.quality_summary = {"summary": "validating: local deterministic fixture"}

    def _cancel_related_run(self, db: Session, task: Task) -> None:
        run = db.get(Run, task.run_id) if task.run_id else None
        if run is not None and run.status not in {"success", "failed", "canceled"}:
            run.status = "canceled"
            run.result_completeness = "canceled"
            run.completed_at = utcnow()

    def _prepare_execution(self, task_id: str, token: LeaseToken) -> bool:
        """Commit the required validating stage before the materialization stage."""

        db = self.session_factory()
        try:
            task = db.get(Task, task_id)
            if task is None:
                return False
            queue = TaskQueue(db, worker_id=self.worker_id, lease_seconds=self.lease_seconds)
            if queue.should_cancel(task, token=token):
                if not queue.cancel(task, token=token):
                    db.rollback()
                    return False
                self._cancel_related_run(db, task)
                db.commit()
                return False
            if not queue.renew(task, token=token):
                db.rollback()
                return False
            self._mark_validating(db, task)
            db.commit()
            return True
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def process_once(self) -> Task | None:
        """Claim and process at most one task with per-attempt fencing."""

        claim_db = self.session_factory()
        task: Task | None = None
        token: LeaseToken | None = None
        try:
            queue = TaskQueue(claim_db, worker_id=self.worker_id, lease_seconds=self.lease_seconds)
            task = queue.claim_next()
            if task is None:
                claim_db.commit()
                return None
            if task.status in {"success", "failed", "canceled"}:
                if task.status == "canceled":
                    self._cancel_related_run(claim_db, task)
                claim_db.commit()
                return task
            token = queue.token_for(task)
            if not queue.start(task, token=token):
                claim_db.commit()
                return task
            claim_db.commit()
        except Exception:
            claim_db.rollback()
            raise
        finally:
            claim_db.close()

        assert task is not None and token is not None
        task_id = token.task_id
        try:
            if not self._prepare_execution(task_id, token):
                return task
            db = self.session_factory()
            try:
                current = db.get(Task, task_id)
                if current is None:
                    return task
                queue = TaskQueue(db, worker_id=self.worker_id, lease_seconds=self.lease_seconds)
                if queue.should_cancel(current, token=token):
                    if not queue.cancel(current, token=token):
                        db.rollback()
                        return task
                    self._cancel_related_run(db, current)
                    db.commit()
                    return task
                if not queue.renew(current, token=token):
                    db.rollback()
                    return task
                self._execute(db, current)
                if queue.should_cancel(current, token=token):
                    if not queue.cancel(current, token=token):
                        db.rollback()
                        return task
                    self._cancel_related_run(db, current)
                else:
                    if not queue.renew(current, token=token) or not queue.complete(current, token=token):
                        db.rollback()
                        return task
                db.commit()
                return task
            except QualityGateBlocked:
                if not queue.fail(
                    task_id,
                    token=token,
                    error_code="QUALITY_GATE_BLOCKED",
                    error_message="Deterministic quality gate blocked this task",
                    retry=False,
                ):
                    db.rollback()
                    return task
                db.commit()
                return task
            finally:
                db.close()
        except LostLease:
            return task
        except Exception:
            retry_db = self.session_factory()
            try:
                retry_queue = TaskQueue(retry_db, worker_id=self.worker_id, lease_seconds=self.lease_seconds)
                if retry_queue.fail(
                    task_id,
                    token=token,
                    error_code="TASK_EXECUTION_FAILED",
                    error_message="Task processing failed",
                    retry=True,
                ):
                    retry_db.commit()
                else:
                    retry_db.rollback()
            finally:
                retry_db.close()
            logger.warning("local task worker failed without exposing task internals")
            return task

    def process_until_idle(self, *, max_tasks: int = 100) -> int:
        processed = 0
        for _ in range(max_tasks):
            if self.process_once() is None:
                break
            processed += 1
        return processed

    async def start(self) -> None:
        self.running = True
        while self.running:
            self.process_once()
            await asyncio.sleep(1)

    def stop(self) -> None:
        self.running = False


def main() -> None:
    if not settings.WORKER_ENABLED:
        logger.warning("Worker is disabled in settings")
        return
    try:
        asyncio.run(Worker().start())
    except KeyboardInterrupt:
        logger.info("Worker stopped")


if __name__ == "__main__":
    main()
