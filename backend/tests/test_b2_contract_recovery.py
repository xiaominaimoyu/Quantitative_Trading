"""Boundary evidence for the reconstructed B1/B2 local-fixture closure."""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import timedelta
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from quant_trading.models.recovery import Artifact, DatasetVersion, Task, utcnow
from quant_trading.services.snapshot_store import SnapshotStoreError
from quant_trading.services.task_queue import TaskQueue
from quant_trading.worker import Worker


def _key(auth: dict[str, str], value: str) -> dict[str, str]:
    return auth | {"Idempotency-Key": value}


def _source_id(client: TestClient, auth: dict[str, str]) -> str:
    response = client.get("/api/v1/data-sources", headers=auth)
    assert response.status_code == 200, response.text
    return next(item["id"] for item in response.json()["items"] if item["name"] == "Deterministic fixture (clean)")


def _create_version(
    client: TestClient,
    auth: dict[str, str],
    *,
    stem: str,
    start: str = "2024-01-01",
    end: str = "2024-01-03",
    symbols: list[str] | None = None,
) -> dict[str, str]:
    dataset = client.post(
        "/api/v1/datasets",
        json={"slug": stem, "name": stem, "market": "CN"},
        headers=_key(auth, f"{stem}-dataset"),
    )
    assert dataset.status_code == 201, dataset.text
    version = client.post(
        f"/api/v1/datasets/{dataset.json()['id']}/versions",
        json={
            "data_source_id": _source_id(client, auth),
            "time_start": start,
            "time_end": end,
            "symbols": symbols or ["600000.SH"],
        },
        headers=_key(auth, f"{stem}-version"),
    )
    assert version.status_code == 202, version.text
    return {
        "dataset_id": dataset.json()["id"],
        "version_id": version.json()["dataset_version_id"],
        "task_id": version.json()["task_id"],
    }


def _window(start: str, end: str) -> dict[str, str]:
    return {"start": f"{start}T00:00:00+08:00", "end": f"{end}T23:59:59+08:00"}


def test_b2_manifest_detached_hash_real_parquet_and_mapper_shape(
    client: TestClient,
    headers,
    worker,
    storage_roots,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = headers("researcher")
    created = _create_version(client, auth, stem="b2-manifest")
    before = client.get(f"/api/v1/dataset-versions/{created['version_id']}", headers=auth)
    assert before.status_code == 200, before.text
    initial = before.json()
    assert initial["status"] == "draft"
    assert isinstance(initial["source"], str)
    assert isinstance(initial["time_range"], str)
    assert initial["quality_summary"] is None

    states: list[str] = []
    original_execute = worker._execute

    def observe_validating(db, task):
        states.append(db.get(DatasetVersion, task.payload["dataset_version_id"]).status)
        return original_execute(db, task)

    monkeypatch.setattr(worker, "_execute", observe_validating)
    assert worker.process_until_idle() == 1
    assert states == ["validating"]

    detail = client.get(f"/api/v1/dataset-versions/{created['version_id']}", headers=auth)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["status"] == "available"
    assert isinstance(body["source"], str)
    assert isinstance(body["time_range"], str)
    assert isinstance(body["quality_summary"], str)
    assert body["latest_quality_run"] is not None
    assert set(body["latest_quality_run"]["results"][0]) == {
        "rule_id", "rule_version", "severity", "status", "count", "message", "samples"
    }

    manifest = body["manifest"]
    assert set(manifest) == {
        "manifest_version", "schema_version", "schema_fingerprint", "dataset_id", "dataset_version_id",
        "parent_version_id", "source", "market", "frequency", "timezone", "adjustment", "primary_key",
        "sort_key", "row_count", "time_range", "partitions", "writer_profile", "generation", "quality",
        "logical_content_sha256", "manifest_sha256",
    }
    assert manifest["schema_version"] == "market_bar_v1"
    assert manifest["primary_key"] == ["symbol", "exchange", "event_time"]
    assert manifest["sort_key"] == ["event_time", "symbol", "exchange"]
    assert set(manifest["partitions"][0]) == {
        "relative_path", "row_count", "size_bytes", "time_range", "symbol_range", "file_sha256"
    }
    assert set(manifest["source"]) == {"name", "revision", "license_ref"}
    assert set(manifest["generation"]) == {"task_id", "code_version", "config_hash"}
    assert set(manifest["quality"]) == {
        "rule_set", "status", "run_id", "report_artifact_id", "report_relative_path", "report_sha256"
    }
    assert manifest["writer_profile"] == {
        "parquet_version": "2.6",
        "compression": "zstd",
        "compression_level": 3,
        "use_dictionary": ["symbol", "exchange"],
        "write_statistics": True,
        "row_group_size": 65536,
        "data_page_version": "2.0",
        "timestamp_unit": "us",
    }

    artifact_root, data_root = map(Path, storage_roots)
    disk_manifest = data_root / "datasets" / created["dataset_id"] / "versions" / created["version_id"] / "manifest.json"
    raw_manifest = disk_manifest.read_bytes()
    detached = json.loads(raw_manifest.decode("utf-8"))
    assert "manifest_sha256" not in detached
    assert raw_manifest == json.dumps(detached, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    assert hashlib.sha256(raw_manifest).hexdigest() == manifest["manifest_sha256"]
    partition = data_root / "datasets" / created["dataset_id"] / "versions" / created["version_id"] / "partitions" / "bars.parquet"
    raw_partition = partition.read_bytes()
    assert raw_partition.startswith(b"PAR1") and raw_partition.endswith(b"PAR1")
    assert hashlib.sha256(raw_partition).hexdigest() == manifest["partitions"][0]["file_sha256"]
    assert len(raw_partition) == manifest["partitions"][0]["size_bytes"]

    artifacts = client.get(f"/api/v1/tasks/{created['task_id']}/artifacts", headers=auth)
    assert artifacts.status_code == 200, artifacts.text
    by_type = {item["artifact_type"]: item for item in artifacts.json()}
    partition_meta = by_type["dataset_partition"]
    UUID(partition_meta["id"])
    assert partition_meta["format"] == "parquet" and partition_meta["storage_kind"] == "data"
    download = client.get(f"/api/v1/artifacts/{partition_meta['id']}/download", headers=auth)
    assert download.status_code == 200, download.text
    assert download.headers["content-type"].startswith("application/vnd.apache.parquet")
    assert download.content == raw_partition
    assert hashlib.sha256(download.content).hexdigest() == partition_meta["sha256"]
    assert len(download.content) == partition_meta["size_bytes"]
    assert (artifact_root / "tasks" / created["task_id"] / f"{partition_meta['id']}.parquet").read_bytes() == raw_partition
    report = client.get(f"/api/v1/artifacts/{by_type['data_quality_report']['id']}/download", headers=auth)
    assert report.status_code == 200 and report.headers["content-type"].startswith("application/json")
    assert json.loads(report.content)["status"] == "passed"


def test_b2_pit_aggregate_constraints_and_integrity_rejection(
    client: TestClient,
    headers,
    worker,
    session_factory,
    storage_roots,
) -> None:
    auth = headers("researcher")
    created = _create_version(client, auth, stem="b2-pit")
    assert worker.process_until_idle() == 1

    full = _window("2024-01-01", "2024-01-03")
    aggregate = client.post(
        f"/api/v1/dataset-versions/{created['version_id']}/aggregate",
        json=full | {"metrics": ["sum_volume"], "max_points": 1000},
        headers=auth,
    )
    assert aggregate.status_code == 200, aggregate.text
    assert aggregate.json()["source_rows"] == 3
    assert len(aggregate.json()["points"]) == 3
    assert "count" not in aggregate.json()["points"][0]
    capped = client.post(
        f"/api/v1/dataset-versions/{created['version_id']}/aggregate",
        json=full | {"metrics": ["sum_volume"], "max_points": 2},
        headers=auth,
    )
    assert capped.status_code == 200 and capped.json()["source_rows"] == 3 and len(capped.json()["points"]) == 2

    cutoff = {"start": "2024-01-01T00:00:00+08:00", "end": "2024-01-02T15:30:00+08:00"}
    rows = client.post(
        f"/api/v1/dataset-versions/{created['version_id']}/query",
        json=cutoff | {"columns": ["event_time", "available_at", "symbol"]},
        headers=auth,
    )
    assert rows.status_code == 200, rows.text
    assert len(rows.json()["items"]) == 1
    aggregate_pit = client.post(
        f"/api/v1/dataset-versions/{created['version_id']}/aggregate",
        json=cutoff | {"metrics": ["sum_volume"]},
        headers=auth,
    )
    assert aggregate_pit.status_code == 200 and aggregate_pit.json()["source_rows"] == 1

    source_id = _source_id(client, auth)
    dataset = client.post(
        "/api/v1/datasets",
        json={"slug": "b2-inputs", "name": "b2-inputs", "market": "CN"},
        headers=_key(auth, "b2-inputs-dataset"),
    )
    assert dataset.status_code == 201
    version_url = f"/api/v1/datasets/{dataset.json()['id']}/versions"
    base = {"data_source_id": source_id, "time_start": "2024-01-01", "time_end": "2024-01-02", "symbols": ["600000.SH"]}
    invalid_bodies = [
        base | {"symbols": ["S"] * 1001},
        base | {"symbols": ["bad/symbol"]},
        base | {"symbols": ["S" * 33]},
        base | {"timezone": "UTC"},
        base | {"adjustment": "split"},
        base | {"time_start": "2020-01-01", "time_end": "2022-09-28", "symbols": [f"S{i:04d}" for i in range(1000)]},
    ]
    for index, invalid in enumerate(invalid_bodies):
        response = client.post(version_url, json=invalid, headers=_key(auth, f"b2-input-{index}"))
        assert response.status_code == 422, response.text

    artifact_root, data_root = map(Path, storage_roots)
    partition_path = data_root / "datasets" / created["dataset_id"] / "versions" / created["version_id"] / "partitions" / "bars.parquet"
    partition_path.write_bytes(b"tampered")
    rejected_partition = client.post(
        f"/api/v1/dataset-versions/{created['version_id']}/query",
        json=full | {"columns": ["close"]},
        headers=auth,
    )
    assert rejected_partition.status_code == 422
    manifest_path = data_root / "datasets" / created["dataset_id"] / "versions" / created["version_id"] / "manifest.json"
    manifest_path.write_text("{}", encoding="utf-8")
    rejected_manifest = client.post(
        f"/api/v1/dataset-versions/{created['version_id']}/aggregate",
        json=full | {"metrics": ["sum_volume"]},
        headers=auth,
    )
    assert rejected_manifest.status_code == 422

    db = session_factory()
    try:
        task = db.get(Task, created["task_id"])
        artifact = db.scalar(select(Artifact).where(Artifact.task_id == created["task_id"], Artifact.artifact_type == "dataset_partition"))
        assert task is not None and artifact is not None
        controlled = artifact_root / "tasks" / created["task_id"] / f"{artifact.id}.parquet"
        controlled.write_bytes(b"tampered")
        with pytest.raises(SnapshotStoreError):
            worker._artifact(
                db,
                task=task,
                artifact_type="dataset_partition",
                binary_data=base64.b64decode(artifact.content),
                artifact_format="parquet",
                storage_kind="data",
            )
    finally:
        db.rollback()
        db.close()


def test_b2_fencing_rejects_stale_owner_and_default_worker_ids(session_factory, storage_roots) -> None:
    artifact_root, data_root = storage_roots
    first_worker = Worker(session_factory=session_factory, artifact_root=artifact_root, data_root=data_root)
    second_worker = Worker(session_factory=session_factory, artifact_root=artifact_root, data_root=data_root)
    assert first_worker.worker_id != second_worker.worker_id

    setup = session_factory()
    try:
        task = Task(task_type="diagnostic", max_attempts=3, payload={"fencing": True})
        setup.add(task)
        setup.commit()
        task_id = task.id
    finally:
        setup.close()

    owner_a = session_factory()
    queue_a = TaskQueue(owner_a, worker_id="owner-a", lease_seconds=60)
    try:
        task_a = queue_a.claim_next()
        assert task_a is not None and queue_a.start(task_a)
        token_a = queue_a.token_for(task_a)
        owner_a.commit()

        expire = session_factory()
        try:
            stale = expire.get(Task, task_id)
            assert stale is not None
            stale.lease_expires_at = utcnow() - timedelta(seconds=1)
            expire.commit()
        finally:
            expire.close()

        owner_b = session_factory()
        try:
            queue_b = TaskQueue(owner_b, worker_id="owner-b", lease_seconds=60)
            task_b = queue_b.claim_next()
            assert task_b is not None and task_b.id == task_id and task_b.attempt_count == 2
            assert queue_b.start(task_b)
            token_b = queue_b.token_for(task_b)
            owner_b.commit()
        finally:
            owner_b.close()

        assert queue_a.complete(task_a, token=token_a) is False
        assert queue_a.cancel(task_a, token=token_a) is False
        assert queue_a.fail(task_id, token=token_a, retry=False) is False
        owner_a.add(Artifact(task_id=task_id, artifact_type="stale-write", format="json", size_bytes=2, content="{}"))
        assert queue_a.complete(task_a, token=token_a) is False
        owner_a.rollback()

        check = session_factory()
        try:
            current = check.get(Task, task_id)
            assert current is not None
            assert current.status == "running" and current.worker_id == "owner-b" and current.attempt_count == token_b.attempt_count
            assert check.scalar(select(Artifact).where(Artifact.task_id == task_id, Artifact.artifact_type == "stale-write")) is None
        finally:
            check.close()
    finally:
        owner_a.close()
