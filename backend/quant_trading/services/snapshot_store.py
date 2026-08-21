"""Controlled storage for reconstructed, deterministic B2 snapshots.

This module owns local paths and never accepts an API-supplied path.  It is a
conservative local-fixture implementation, not a market-data store.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

try:  # Keep ASGI/OpenAPI imports independent from optional worker dependencies.
    import duckdb
except ModuleNotFoundError:  # pragma: no cover - dependency-light compatibility export
    duckdb = None

from quant_trading.services.recovery import canonical_json, jsonable


_IDENTIFIER = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_ALLOWED_COLUMNS = (
    "symbol",
    "exchange",
    "event_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "available_at",
    "ingested_at",
    "source_revision",
)
_ALLOWED_METRICS = {"count", "avg_close", "sum_volume", "min_low", "max_high"}
_MANIFEST_KEYS = {
    "manifest_version",
    "schema_version",
    "schema_fingerprint",
    "dataset_id",
    "dataset_version_id",
    "parent_version_id",
    "source",
    "market",
    "frequency",
    "timezone",
    "adjustment",
    "primary_key",
    "sort_key",
    "row_count",
    "time_range",
    "partitions",
    "writer_profile",
    "generation",
    "quality",
    "logical_content_sha256",
    "manifest_sha256",
}
_PARTITION_KEYS = {
    "relative_path",
    "row_count",
    "size_bytes",
    "time_range",
    "symbol_range",
    "file_sha256",
}
_ARTIFACT_NAMESPACE = uuid.UUID("3a8ee08d-3836-4436-91c5-3b47ad839405")
_SHANGHAI = ZoneInfo("Asia/Shanghai")


class SnapshotStoreError(ValueError):
    """A safe, non-path-bearing local-storage failure."""


def _duckdb_connection():
    if duckdb is None:
        raise SnapshotStoreError("local snapshot engine is unavailable")
    return duckdb.connect(":memory:")


def _arrow_modules():
    """Load Arrow only while a local snapshot is actually materialized."""

    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
        from quant_trading.data.schema import MARKET_BAR_SCHEMA
        from quant_trading.data.snapshot import WRITER_PROFILE
    except ModuleNotFoundError as exc:  # pragma: no cover - configuration failure
        raise SnapshotStoreError("local parquet writer is unavailable") from exc
    return pa, pq, MARKET_BAR_SCHEMA, WRITER_PROFILE


@dataclass(frozen=True, slots=True)
class StoredArtifact:
    artifact_id: str
    content: str
    sha256: str
    size_bytes: int
    extension: str


@dataclass(frozen=True, slots=True)
class MaterializedSnapshot:
    manifest: dict[str, Any]
    manifest_text: str
    manifest_sha256: str
    partition_sha256: str
    partition_size_bytes: int
    row_count: int


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _stable_id(task_id: str, artifact_type: str) -> str:
    """Return a deterministic *valid UUID*, suitable for DB and file identity."""

    return str(uuid.uuid5(_ARTIFACT_NAMESPACE, f"{task_id}:{artifact_type}"))


def _canonical_bytes(value: Any) -> bytes:
    return canonical_json(value).encode("utf-8")


def _validate_id(value: str) -> str:
    if not _IDENTIFIER.fullmatch(str(value)):
        raise SnapshotStoreError("managed storage identifier is invalid")
    return str(value)


def _validate_extension(value: str) -> str:
    if value not in {"json", "parquet", "html", "md", "txt"}:
        raise SnapshotStoreError("managed artifact format is invalid")
    return value


def _decode_cursor(value: str | None) -> tuple[str, str, str] | None:
    if value is None:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        item = json.loads(decoded.decode("utf-8"))
        fields = (item["event_time"], item["symbol"], item["exchange"])
    except (KeyError, TypeError, UnicodeDecodeError, ValueError, json.JSONDecodeError):
        raise SnapshotStoreError("cursor is invalid") from None
    if not all(isinstance(part, str) and part for part in fields):
        raise SnapshotStoreError("cursor is invalid")
    return fields


def _encode_cursor(event_time: Any, symbol: Any, exchange: Any) -> str:
    payload = {
        "event_time": event_time.isoformat() if isinstance(event_time, (date, datetime)) else str(event_time),
        "symbol": str(symbol),
        "exchange": str(exchange),
    }
    return base64.urlsafe_b64encode(_canonical_bytes(payload)).decode("ascii").rstrip("=")


def _time_bound(value: str | date | datetime, *, end: bool) -> datetime:
    """Normalize documented date/date-time values to a UTC instant.

    Date-only compatibility treats a local Shanghai date as its inclusive start
    or end.  Offset-bearing timestamps are converted rather than having their
    offset discarded.
    """

    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.max if end else time.min)
    elif isinstance(value, str) and len(value) == 10:
        try:
            parsed = datetime.combine(date.fromisoformat(value), time.max if end else time.min)
        except ValueError:
            raise SnapshotStoreError("date range is invalid") from None
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            raise SnapshotStoreError("date range is invalid") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_SHANGHAI)
    return parsed.astimezone(timezone.utc)


class SnapshotStore:
    """Own immutable local snapshot and artifact writes below controlled roots."""

    def __init__(self, *, artifact_root: Path | str, data_root: Path | str):
        self.artifact_root = Path(artifact_root)
        self.data_root = Path(data_root)

    @staticmethod
    def _managed_path(root: Path, *parts: str) -> Path:
        root_resolved = root.resolve(strict=False)
        candidate = root_resolved.joinpath(*parts).resolve(strict=False)
        try:
            candidate.relative_to(root_resolved)
        except ValueError:
            raise SnapshotStoreError("managed storage path escaped its root") from None
        return candidate

    @staticmethod
    def _remove_controlled(path: Path, root: Path) -> None:
        root_resolved = root.resolve(strict=False)
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(root_resolved)
        except ValueError:
            raise SnapshotStoreError("staging cleanup escaped its root") from None
        if path.exists() or path.is_symlink():
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink()

    def artifact_id(self, *, task_id: str, artifact_type: str) -> str:
        return _stable_id(_validate_id(task_id), artifact_type)

    def artifact_relative_path(self, *, task_id: str, artifact_type: str, extension: str) -> str:
        artifact_id = self.artifact_id(task_id=task_id, artifact_type=artifact_type)
        return f"tasks/{_validate_id(task_id)}/{artifact_id}.{_validate_extension(extension)}"

    def _task_target(self, task_id: str, artifact_type: str, extension: str) -> tuple[str, Path]:
        checked_task_id = _validate_id(task_id)
        checked_extension = _validate_extension(extension)
        artifact_id = _stable_id(checked_task_id, artifact_type)
        return artifact_id, self._managed_path(
            self.artifact_root,
            "tasks",
            checked_task_id,
            f"{artifact_id}.{checked_extension}",
        )

    def _staging_path(self, root: Path, token: str) -> Path:
        return self._managed_path(root, ".staging", token)

    def _write_task_bytes(
        self,
        *,
        task_id: str,
        artifact_type: str,
        extension: str,
        data: bytes,
        content: str,
    ) -> StoredArtifact:
        artifact_id, target = self._task_target(task_id, artifact_type, extension)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            if target.is_symlink():
                raise SnapshotStoreError("managed artifact is invalid")
            existing = target.read_bytes()
            if existing != data:
                raise SnapshotStoreError("managed artifact integrity check failed")
            return StoredArtifact(artifact_id, content, _sha256(existing), len(existing), extension)
        stage = self._staging_path(self.artifact_root, f"artifact-{artifact_id}-{uuid.uuid4().hex}.tmp")
        stage.parent.mkdir(parents=True, exist_ok=True)
        try:
            stage.write_bytes(data)
            try:
                os.replace(stage, target)
            except FileExistsError:
                existing = target.read_bytes()
                if existing != data:
                    raise SnapshotStoreError("managed artifact integrity check failed") from None
        finally:
            if stage.exists() or stage.is_symlink():
                self._remove_controlled(stage, self.artifact_root)
        return StoredArtifact(artifact_id, content, _sha256(data), len(data), extension)

    def write_task_json(self, *, task_id: str, artifact_type: str, value: dict[str, Any]) -> StoredArtifact:
        data = _canonical_bytes(value)
        return self._write_task_bytes(
            task_id=task_id,
            artifact_type=artifact_type,
            extension="json",
            data=data,
            content=data.decode("utf-8"),
        )

    def write_task_binary(
        self,
        *,
        task_id: str,
        artifact_type: str,
        extension: str,
        data: bytes,
    ) -> StoredArtifact:
        return self._write_task_bytes(
            task_id=task_id,
            artifact_type=artifact_type,
            extension=extension,
            data=data,
            content=base64.b64encode(data).decode("ascii"),
        )

    def read_task_artifact(self, *, task_id: str, artifact_type: str, extension: str) -> bytes:
        _, target = self._task_target(task_id, artifact_type, extension)
        if not target.exists() or target.is_symlink():
            raise SnapshotStoreError("managed artifact is unavailable")
        return target.read_bytes()

    def _version_root(self, dataset_id: str, version_id: str) -> Path:
        return self._managed_path(
            self.data_root,
            "datasets",
            _validate_id(dataset_id),
            "versions",
            _validate_id(version_id),
        )

    @staticmethod
    def _validate_manifest_shape(manifest: dict[str, Any], *, detached: bool) -> None:
        expected = _MANIFEST_KEYS - ({"manifest_sha256"} if detached else set())
        if set(manifest) != expected:
            raise SnapshotStoreError("snapshot manifest is invalid")
        if manifest.get("schema_version") != "market_bar_v1" or manifest.get("timezone") != "Asia/Shanghai":
            raise SnapshotStoreError("snapshot manifest is invalid")
        if manifest.get("primary_key") != ["symbol", "exchange", "event_time"]:
            raise SnapshotStoreError("snapshot manifest is invalid")
        if manifest.get("sort_key") != ["event_time", "symbol", "exchange"]:
            raise SnapshotStoreError("snapshot manifest is invalid")
        partitions = manifest.get("partitions")
        if not isinstance(partitions, list) or len(partitions) != 1 or not isinstance(partitions[0], dict):
            raise SnapshotStoreError("snapshot manifest is invalid")
        if set(partitions[0]) != _PARTITION_KEYS:
            raise SnapshotStoreError("snapshot manifest is invalid")
        if partitions[0].get("relative_path") != "partitions/bars.parquet":
            raise SnapshotStoreError("snapshot manifest is invalid")

    @staticmethod
    def _arrow_table(rows: list[dict[str, Any]]):
        pa, _pq, schema, _profile = _arrow_modules()
        try:
            return pa.Table.from_pylist(rows, schema=schema)
        except (TypeError, ValueError, OverflowError) as exc:
            raise SnapshotStoreError("deterministic fixture rows are invalid") from exc

    def _write_parquet(self, path: Path, rows: list[dict[str, Any]]) -> None:
        _pa, pq, schema, profile = _arrow_modules()
        table = self._arrow_table(rows)
        with pq.ParquetWriter(
            path,
            schema,
            version=profile["parquet_version"],
            compression=profile["compression"],
            compression_level=profile["compression_level"],
            use_dictionary=profile["use_dictionary"],
            write_statistics=profile["write_statistics"],
            data_page_version=profile["data_page_version"],
        ) as writer:
            writer.write_table(table, row_group_size=profile["row_group_size"])

    def _validate_existing_snapshot(
        self,
        *,
        final_root: Path,
        expected_manifest_bytes: bytes,
        expected_partition_bytes: bytes,
    ) -> MaterializedSnapshot:
        if final_root.is_symlink():
            raise SnapshotStoreError("snapshot data is unavailable")
        manifest_path = self._managed_path(final_root, "manifest.json")
        partition_path = self._managed_path(final_root, "partitions", "bars.parquet")
        if (
            not manifest_path.exists()
            or manifest_path.is_symlink()
            or not partition_path.exists()
            or partition_path.is_symlink()
        ):
            raise SnapshotStoreError("snapshot data is unavailable")
        raw_manifest = manifest_path.read_bytes()
        partition_bytes = partition_path.read_bytes()
        try:
            detached = json.loads(raw_manifest.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise SnapshotStoreError("snapshot manifest is invalid") from None
        self._validate_manifest_shape(detached, detached=True)
        if raw_manifest != _canonical_bytes(detached):
            raise SnapshotStoreError("snapshot manifest integrity check failed")
        if raw_manifest != expected_manifest_bytes or partition_bytes != expected_partition_bytes:
            raise SnapshotStoreError("snapshot identity or integrity check failed")
        attached = {**detached, "manifest_sha256": _sha256(raw_manifest)}
        self._validate_manifest_shape(attached, detached=False)
        return MaterializedSnapshot(
            manifest=attached,
            manifest_text=raw_manifest.decode("utf-8"),
            manifest_sha256=attached["manifest_sha256"],
            partition_sha256=_sha256(partition_bytes),
            partition_size_bytes=len(partition_bytes),
            row_count=int(detached["row_count"]),
        )

    def materialize_snapshot(
        self,
        *,
        dataset_id: str,
        version_id: str,
        rows: Iterable[dict[str, Any]],
        manifest_base: dict[str, Any],
    ) -> MaterializedSnapshot:
        """Atomically write and verify one immutable Parquet snapshot.

        ``manifest.json`` uses detached-hash semantics: it is canonical JSON
        without ``manifest_sha256``; its actual byte hash is stored in the DB
        and added to the returned API manifest.
        """

        final_root = self._version_root(dataset_id, version_id)
        if final_root.exists() and final_root.is_symlink():
            raise SnapshotStoreError("snapshot data is unavailable")
        ordered_rows = sorted(
            (dict(row) for row in rows),
            key=lambda row: (str(row["event_time"]), str(row["symbol"]), str(row["exchange"])),
        )
        stage = self._staging_path(self.data_root, f"snapshot-{_validate_id(version_id)}-{uuid.uuid4().hex}")
        partition = self._managed_path(stage, "partitions", "bars.parquet")
        partition.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._write_parquet(partition, ordered_rows)
            partition_bytes = partition.read_bytes()
            _pa, _pq, schema, profile = _arrow_modules()
            partition_entry = {
                "relative_path": "partitions/bars.parquet",
                "row_count": len(ordered_rows),
                "size_bytes": len(partition_bytes),
                "time_range": dict(manifest_base["time_range"]),
                "symbol_range": {
                    "start": min((str(row["symbol"]) for row in ordered_rows), default=None),
                    "end": max((str(row["symbol"]) for row in ordered_rows), default=None),
                },
                "file_sha256": _sha256(partition_bytes),
            }
            detached_manifest = {
                **manifest_base,
                "schema_fingerprint": _sha256(schema.serialize().to_pybytes()),
                "row_count": len(ordered_rows),
                "partitions": [partition_entry],
                "writer_profile": dict(profile),
            }
            detached_manifest.pop("manifest_sha256", None)
            self._validate_manifest_shape(detached_manifest, detached=True)
            manifest_bytes = _canonical_bytes(detached_manifest)
            manifest_path = self._managed_path(stage, "manifest.json")
            manifest_path.write_bytes(manifest_bytes)
            final_root.parent.mkdir(parents=True, exist_ok=True)
            if final_root.exists():
                return self._validate_existing_snapshot(
                    final_root=final_root,
                    expected_manifest_bytes=manifest_bytes,
                    expected_partition_bytes=partition_bytes,
                )
            try:
                os.replace(stage, final_root)
            except FileExistsError:
                return self._validate_existing_snapshot(
                    final_root=final_root,
                    expected_manifest_bytes=manifest_bytes,
                    expected_partition_bytes=partition_bytes,
                )
            return self._validate_existing_snapshot(
                final_root=final_root,
                expected_manifest_bytes=manifest_bytes,
                expected_partition_bytes=partition_bytes,
            )
        finally:
            if stage.exists() or stage.is_symlink():
                self._remove_controlled(stage, self.data_root)

    def remove_snapshot(self, *, dataset_id: str, version_id: str) -> None:
        """Remove only this controlled uncommitted snapshot location."""

        self._remove_controlled(self._version_root(dataset_id, version_id), self.data_root)

    def _partition_for(self, *, dataset_id: str, version_id: str, manifest: dict[str, Any]) -> Path:
        self._validate_manifest_shape(manifest, detached=False)
        root = self._version_root(dataset_id, version_id)
        manifest_path = self._managed_path(root, "manifest.json")
        partition_path = self._managed_path(root, "partitions", "bars.parquet")
        if (
            not manifest_path.exists()
            or manifest_path.is_symlink()
            or not partition_path.exists()
            or partition_path.is_symlink()
        ):
            raise SnapshotStoreError("snapshot data is unavailable")
        raw = manifest_path.read_bytes()
        try:
            detached = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise SnapshotStoreError("snapshot manifest is invalid") from None
        self._validate_manifest_shape(detached, detached=True)
        if raw != _canonical_bytes(detached) or _sha256(raw) != manifest["manifest_sha256"]:
            raise SnapshotStoreError("snapshot manifest integrity check failed")
        expected_attached = {**detached, "manifest_sha256": _sha256(raw)}
        if expected_attached != manifest:
            raise SnapshotStoreError("snapshot manifest integrity check failed")
        data = partition_path.read_bytes()
        partition = detached["partitions"][0]
        if len(data) != partition["size_bytes"] or _sha256(data) != partition["file_sha256"]:
            raise SnapshotStoreError("snapshot partition integrity check failed")
        return partition_path

    def read_snapshot_partition(
        self,
        *,
        dataset_id: str,
        version_id: str,
        manifest: dict[str, Any],
    ) -> bytes:
        """Read only a validated controlled Parquet partition."""

        return self._partition_for(
            dataset_id=dataset_id,
            version_id=version_id,
            manifest=manifest,
        ).read_bytes()

    @staticmethod
    def _predicates(
        *,
        start: str | date | datetime,
        end: str | date | datetime,
        symbols: list[str] | None,
    ) -> tuple[list[str], list[Any], datetime]:
        start_at, end_at = _time_bound(start, end=False), _time_bound(end, end=True)
        if start_at > end_at:
            raise SnapshotStoreError("date range is invalid")
        predicates = [
            "event_time >= CAST(? AS TIMESTAMPTZ)",
            "event_time <= CAST(? AS TIMESTAMPTZ)",
            "available_at <= CAST(? AS TIMESTAMPTZ)",
        ]
        params: list[Any] = [start_at, end_at, end_at]
        if symbols:
            clean_symbols = sorted({str(symbol) for symbol in symbols if isinstance(symbol, str) and symbol})
            if not clean_symbols:
                raise SnapshotStoreError("symbols are invalid")
            predicates.append("symbol IN (" + ", ".join("?" for _ in clean_symbols) + ")")
            params.extend(clean_symbols)
        return predicates, params, end_at

    def query_rows(
        self,
        *,
        dataset_id: str,
        version_id: str,
        manifest: dict[str, Any],
        start: str | date | datetime,
        end: str | date | datetime,
        columns: list[str],
        symbols: list[str] | None,
        cursor: str | None,
        limit: int,
    ) -> dict[str, Any]:
        if not columns or any(column not in _ALLOWED_COLUMNS for column in columns):
            raise SnapshotStoreError("requested columns are invalid")
        if limit < 1 or limit > 100:
            raise SnapshotStoreError("limit is invalid")
        cursor_values = _decode_cursor(cursor)
        partition = self._partition_for(dataset_id=dataset_id, version_id=version_id, manifest=manifest)
        predicates, params, _end_at = self._predicates(start=start, end=end, symbols=symbols)
        if cursor_values is not None:
            event_time, symbol, exchange = cursor_values
            predicates.append(
                "(event_time > CAST(? AS TIMESTAMPTZ) OR "
                "(event_time = CAST(? AS TIMESTAMPTZ) AND "
                "(symbol > ? OR (symbol = ? AND exchange > ?))))"
            )
            params.extend([event_time, event_time, symbol, symbol, exchange])
        timestamp_columns = {"event_time", "available_at", "ingested_at"}
        selected = ", ".join(
            f"CAST({column} AS VARCHAR) AS {column}" if column in timestamp_columns else column
            for column in columns
        )
        sql = (
            "SELECT CAST(event_time AS VARCHAR) AS __cursor_event_time, symbol AS __cursor_symbol, exchange AS __cursor_exchange, "
            + selected
            + " FROM read_parquet(?) WHERE "
            + " AND ".join(predicates)
            + " ORDER BY event_time, symbol, exchange LIMIT ?"
        )
        connection = _duckdb_connection()
        try:
            result = connection.execute(sql, [str(partition), *params, limit + 1])
            names = [item[0] for item in result.description]
            raw_rows = [dict(zip(names, row, strict=True)) for row in result.fetchall()]
        finally:
            connection.close()
        has_more = len(raw_rows) > limit
        retained = raw_rows[:limit]
        items = [{column: jsonable(row[column]) for column in columns} for row in retained]
        next_cursor = None
        if has_more and retained:
            last = retained[-1]
            next_cursor = _encode_cursor(last["__cursor_event_time"], last["__cursor_symbol"], last["__cursor_exchange"])
        return {"items": items, "page": {"has_more": has_more, "next_cursor": next_cursor}}

    def aggregate_rows(
        self,
        *,
        dataset_id: str,
        version_id: str,
        manifest: dict[str, Any],
        start: str | date | datetime,
        end: str | date | datetime,
        metrics: list[str],
        symbols: list[str] | None,
        max_points: int = 1000,
    ) -> dict[str, Any]:
        if not metrics or any(metric not in _ALLOWED_METRICS for metric in metrics):
            raise SnapshotStoreError("requested metrics are invalid")
        if max_points < 1 or max_points > 1000:
            raise SnapshotStoreError("max_points is invalid")
        partition = self._partition_for(dataset_id=dataset_id, version_id=version_id, manifest=manifest)
        predicates, params, _end_at = self._predicates(start=start, end=end, symbols=symbols)
        expressions = {
            "count": "COUNT(*) AS count",
            "avg_close": "AVG(close) AS avg_close",
            "sum_volume": "SUM(volume) AS sum_volume",
            "min_low": "MIN(low) AS min_low",
            "max_high": "MAX(high) AS max_high",
        }
        where = " AND ".join(predicates)
        connection = _duckdb_connection()
        try:
            total = connection.execute(
                "SELECT COUNT(*) FROM read_parquet(?) WHERE " + where,
                [str(partition), *params],
            ).fetchone()[0]
            result = connection.execute(
                "SELECT CAST(event_time AT TIME ZONE 'Asia/Shanghai' AS DATE) AS trading_day, "
                + ", ".join(expressions[metric] for metric in metrics)
                + " FROM read_parquet(?) WHERE "
                + where
                + " GROUP BY trading_day ORDER BY trading_day ASC LIMIT ?",
                [str(partition), *params, max_points],
            )
            names = [item[0] for item in result.description]
            rows = [dict(zip(names, row, strict=True)) for row in result.fetchall()]
        finally:
            connection.close()
        points = []
        for row in rows:
            trading_day = str(row.pop("trading_day"))
            point = {"start": trading_day, "end": trading_day}
            point.update({name: jsonable(value) for name, value in row.items()})
            points.append(point)
        return {"points": points, "source_rows": int(total)}
