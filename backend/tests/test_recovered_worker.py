"""Evidence tests for the reconstructed local queue and deterministic snapshots."""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from quant_trading.config import Settings
from quant_trading.models.recovery import Artifact, DataSource, DatasetVersion, Task, WorkerHeartbeat, utcnow
from quant_trading.seed import ensure_deterministic_fixture_sources
from quant_trading.services.task_queue import TaskQueue


def _auth(headers) -> dict[str, str]:
    return headers("researcher")


def _key(auth: dict[str, str], value: str) -> dict[str, str]:
    return auth | {"Idempotency-Key": value}


def _source_id(client: TestClient, auth: dict[str, str], name: str) -> str:
    response = client.get("/api/v1/data-sources", headers=auth)
    assert response.status_code == 200, response.text
    return next(item["id"] for item in response.json()["items"] if item["name"] == name)


def _dataset_version(client: TestClient, auth: dict[str, str], source_id: str, slug: str, *, parent_version_id: str | None = None) -> dict[str, str]:
    dataset = client.post(
        "/api/v1/datasets",
        json={"slug": slug, "name": slug, "market": "CN"},
        headers=_key(auth, f"{slug}-dataset"),
    )
    assert dataset.status_code == 201, dataset.text
    body: dict[str, object] = {
        "data_source_id": source_id,
        "time_start": "2024-01-01",
        "time_end": "2024-01-05",
        "symbols": ["600000.SH", "000001.SZ"],
    }
    if parent_version_id:
        body["parent_version_id"] = parent_version_id
    version = client.post(
        f"/api/v1/datasets/{dataset.json()['id']}/versions",
        json=body,
        headers=_key(auth, f"{slug}-version"),
    )
    assert version.status_code == 202, version.text
    assert version.json()["status"] == "queued"
    return {"dataset_id": dataset.json()["id"], "version_id": version.json()["dataset_version_id"], "task_id": version.json()["task_id"]}


def test_diagnostic_worker_transitions_and_writes_canonical_utf8_artifact(session_factory, worker, storage_roots) -> None:
    db = session_factory()
    try:
        task = Task(task_type="diagnostic", owner_key="worker-test", payload={"message": "中文", "z": 1})
        db.add(task)
        db.commit()
        task_id = task.id
    finally:
        db.close()

    assert worker.process_once() is not None

    db = session_factory()
    try:
        stored_task = db.get(Task, task_id)
        artifact = db.scalar(select(Artifact).where(Artifact.task_id == task_id, Artifact.artifact_type == "task_result"))
        heartbeat = db.get(WorkerHeartbeat, "test-worker")
        assert stored_task is not None and stored_task.status == "success"
        assert stored_task.attempt_count == 1 and stored_task.completed_at is not None
        assert artifact is not None and heartbeat is not None and heartbeat.current_task_id is None
        assert json.loads(artifact.content)["payload"] == {"message": "中文", "z": 1}
        assert "\\u4e2d" not in artifact.content
    finally:
        db.close()

    files = list(Path(storage_roots[0]).rglob("*.json"))
    assert len(files) == 1
    raw = files[0].read_bytes()
    assert raw.decode("utf-8") == artifact.content
    assert hashlib.sha256(raw).hexdigest() == artifact.sha256
    assert len(raw) == artifact.size_bytes


def test_queue_does_not_double_claim_active_leases_and_recovers_expired_ones(session_factory) -> None:
    db = session_factory()
    try:
        task = Task(task_type="diagnostic", priority=900, max_attempts=3)
        cancelled = Task(task_type="diagnostic", status="cancel_requested")
        db.add_all([task, cancelled])
        db.commit()
        task_id, cancelled_id = task.id, cancelled.id
    finally:
        db.close()

    first_db = session_factory()
    try:
        first = TaskQueue(first_db, worker_id="one", lease_seconds=60).claim_next()
        assert first is not None and first.id == cancelled_id and first.status == "canceled"
        first_db.commit()
        first = TaskQueue(first_db, worker_id="one", lease_seconds=60).claim_next()
        assert first is not None and first.id == task_id and first.status == "claimed"
        first_db.commit()
    finally:
        first_db.close()

    second_db = session_factory()
    try:
        assert TaskQueue(second_db, worker_id="two", lease_seconds=60).claim_next() is None
        second_db.commit()
    finally:
        second_db.close()

    stale_db = session_factory()
    try:
        stale = stale_db.get(Task, task_id)
        exhausted_task = Task(task_type="diagnostic", priority=1, max_attempts=1)
        stale_db.add(exhausted_task)
        stale_db.flush()
        exhausted_id = exhausted_task.id
        assert stale is not None
        stale.lease_expires_at = utcnow() - timedelta(seconds=1)
        exhausted_task.lease_expires_at = utcnow() - timedelta(seconds=1)
        exhausted_task.status = "claimed"
        exhausted_task.worker_id = "old"
        exhausted_task.attempt_count = 1
        stale_db.commit()
    finally:
        stale_db.close()

    recovered_db = session_factory()
    try:
        recovered = TaskQueue(recovered_db, worker_id="two", lease_seconds=60).claim_next()
        assert recovered is not None and recovered.id == task_id
        assert recovered.attempt_count == 2 and recovered.worker_id == "two"
        recovered_db.commit()
    finally:
        recovered_db.close()

    check_db = session_factory()
    try:
        exhausted_task = check_db.get(Task, exhausted_id)
        cancelled_task = check_db.get(Task, cancelled_id)
        assert exhausted_task is not None and exhausted_task.status == "failed"
        assert exhausted_task.error_code == "TASK_MAX_ATTEMPTS_EXCEEDED"
        assert cancelled_task is not None and cancelled_task.status == "canceled"
    finally:
        check_db.close()


def test_worker_retries_are_sanitized_and_do_not_persist_partial_artifacts(session_factory, worker, monkeypatch) -> None:
    db = session_factory()
    try:
        task = Task(task_type="diagnostic", max_attempts=2, payload={"safe": True})
        db.add(task)
        db.commit()
        task_id = task.id
    finally:
        db.close()

    def explode(_db, _task):
        raise RuntimeError("postgresql://secret-user:secret-pass@host/private")

    monkeypatch.setattr(worker, "_execute", explode)
    assert worker.process_once() is not None
    db = session_factory()
    try:
        retrying = db.get(Task, task_id)
        assert retrying is not None and retrying.status == "queued" and retrying.attempt_count == 1
        assert retrying.error_code == "TASK_EXECUTION_FAILED"
        assert "secret" not in (retrying.error_message or "").lower()
        assert db.scalar(select(Artifact).where(Artifact.task_id == task_id)) is None
    finally:
        db.close()

    assert worker.process_once() is not None
    db = session_factory()
    try:
        terminal = db.get(Task, task_id)
        assert terminal is not None and terminal.status == "failed" and terminal.attempt_count == 2
    finally:
        db.close()


def test_clean_snapshot_query_aggregate_artifacts_and_blocked_gate_cleanup(client: TestClient, headers, worker, session_factory, storage_roots) -> None:
    auth = _auth(headers)
    clean = _dataset_version(client, auth, _source_id(client, auth, "Deterministic fixture (clean)"), "worker-clean")
    assert worker.process_until_idle() == 1

    artifacts = client.get(f"/api/v1/tasks/{clean['task_id']}/artifacts", headers=auth)
    assert artifacts.status_code == 200
    assert {item["artifact_type"] for item in artifacts.json()} == {"dataset_partition", "dataset_manifest", "data_quality_report"}
    version = client.get(f"/api/v1/dataset-versions/{clean['version_id']}", headers=auth)
    assert version.status_code == 200 and version.json()["status"] == "available"
    assert version.json()["quality_status"] == "passed" and version.json()["manifest"]["row_count"] == 10

    first = client.post(
        f"/api/v1/dataset-versions/{clean['version_id']}/query",
            json={"start": "2024-01-01T00:00:00+08:00", "end": "2024-01-05T23:59:59+08:00", "columns": ["event_time", "symbol", "close"], "limit": 2},
        headers=auth,
    )
    assert first.status_code == 200, first.text
    assert len(first.json()["items"]) == 2 and first.json()["page"]["has_more"]
    second = client.post(
        f"/api/v1/dataset-versions/{clean['version_id']}/query",
        json={
                "start": "2024-01-01T00:00:00+08:00",
                "end": "2024-01-05T23:59:59+08:00",
            "columns": ["event_time", "symbol", "close"],
            "limit": 2,
            "cursor": first.json()["page"]["next_cursor"],
        },
        headers=auth,
    )
    assert second.status_code == 200 and second.json()["items"][0] != first.json()["items"][-1]
    pit = client.post(
        f"/api/v1/dataset-versions/{clean['version_id']}/query",
        json={
                "start": "2024-01-01T00:00:00+08:00",
                "end": "2024-01-02T15:30:00+08:00",
                "columns": ["event_time", "symbol"],
        },
        headers=auth,
    )
    assert pit.status_code == 200 and len(pit.json()["items"]) == 2
    assert {item["event_time"] for item in pit.json()["items"]} == {"2024-01-01 15:00:00+08"}
    aggregate = client.post(
        f"/api/v1/dataset-versions/{clean['version_id']}/aggregate",
        json={"start": "2024-01-01T00:00:00+08:00", "end": "2024-01-05T23:59:59+08:00", "metrics": ["count", "sum_volume"]},
        headers=auth,
    )
    assert aggregate.status_code == 200 and aggregate.json()["source_rows"] == 10
    assert len(aggregate.json()["points"]) == 5 and aggregate.json()["points"][0]["count"] == 2

    blocked = _dataset_version(client, auth, _source_id(client, auth, "Deterministic fixture (blocked)"), "worker-blocked")
    assert worker.process_until_idle() == 1
    blocked_task = client.get(f"/api/v1/tasks/{blocked['task_id']}", headers=auth)
    blocked_version = client.get(f"/api/v1/dataset-versions/{blocked['version_id']}", headers=auth)
    assert blocked_task.json()["status"] == "failed" and blocked_task.json()["error_code"] == "QUALITY_GATE_BLOCKED"
    assert blocked_version.json()["status"] == "failed" and blocked_version.json()["quality_status"] == "blocked"
    assert blocked_version.json()["manifest"] is None
    assert not (Path(storage_roots[1]) / "datasets" / blocked["dataset_id"] / "versions" / blocked["version_id"]).exists()
    denied = client.post(
        f"/api/v1/dataset-versions/{blocked['version_id']}/query",
        json={"start": "2024-01-01", "end": "2024-01-05", "columns": ["close"]},
        headers=auth,
    )
    assert denied.status_code == 409 and denied.json()["error"]["code"] == "DATASET_VERSION_NOT_QUERYABLE"


def test_public_task_boundary_health_heartbeat_config_aliases_and_seed(client: TestClient, headers, worker, session_factory, monkeypatch) -> None:
    auth = _auth(headers)
    rejected = client.post("/api/v1/tasks", json={"task_type": "backtest"}, headers=auth)
    assert rejected.status_code == 422
    created = client.post(
        "/api/v1/tasks",
        json={"task_type": "diagnostic", "payload": {"check": "ok"}},
        headers=auth,
    )
    assert created.status_code == 201 and created.json()["status"] == "queued" and created.json()["priority"] == 100
    assert worker.process_until_idle() == 1
    system = client.get("/api/v1/health/system", headers=auth)
    assert system.status_code == 200
    assert system.json()["tasks"] == {"queued": 0, "claimed": 0, "running": 0}
    assert any(item["worker_id"] == "test-worker" for item in system.json()["workers"])

    monkeypatch.setenv("QUANT_DATABASE_URL", "sqlite+pysqlite://")
    monkeypatch.setenv("QUANT_ENV", "test")
    monkeypatch.setenv("QUANT_WORKER_HEARTBEAT_SECONDS", "9")
    monkeypatch.setenv("QUANT_TASK_LEASE_SECONDS", "11")
    configured = Settings()
    assert configured.DATABASE_URL == "sqlite+pysqlite://"
    assert configured.ENVIRONMENT == "test"
    assert configured.WORKER_HEARTBEAT_SECONDS == 9 and configured.TASK_LEASE_SECONDS == 11

    db = session_factory()
    try:
        ensure_deterministic_fixture_sources(db)
        ensure_deterministic_fixture_sources(db)
        db.commit()
        assert len(db.scalars(select(DataSource)).all()) == 2
        assert db.scalar(select(DatasetVersion).limit(1)) is None
    finally:
        db.close()
