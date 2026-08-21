from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from quant_trading.main import app


def _headers(key: str, auth: dict[str, str]) -> dict[str, str]:
    return auth | {"Idempotency-Key": key}


def _clean_source_id(client: TestClient, auth: dict[str, str]) -> str:
    response = client.get("/api/v1/data-sources", headers=auth)
    assert response.status_code == 200, response.text
    return next(item["id"] for item in response.json()["items"] if item["name"] == "Deterministic fixture (clean)")


def _container_and_frozen_version(client: TestClient, auth: dict[str, str], kind: str) -> str:
    plural = {"strategy": "strategies", "model": "models", "risk_rule_set": "risk-rule-sets"}[kind]
    create = client.post(
        f"/api/v1/{plural}",
        json={"slug": f"{kind}-one", "name": f"{kind} one", "description": "test"},
        headers=_headers(f"{kind}-container", auth),
    )
    assert create.status_code == 201, create.text
    container_id = create.json()["item"]["id"]
    version = client.post(
        f"/api/v1/{plural}/{container_id}/versions",
        json={"content": {"contract_version": "v1", "kind": kind}},
        headers=_headers(f"{kind}-version", auth),
    )
    assert version.status_code == 201, version.text
    version_id = version.json()["item"]["id"]
    freeze_root = {"strategy": "strategy-versions", "model": "model-versions", "risk_rule_set": "risk-rule-versions"}[kind]
    freeze = client.post(
        f"/api/v1/{freeze_root}/{version_id}/freeze",
        json={"reason": "freeze for deterministic experiment"},
        headers=_headers(f"{kind}-freeze", auth),
    )
    assert freeze.status_code == 200, freeze.text
    assert freeze.json()["item"]["content_sha256"] == version.json()["item"]["content_sha256"]
    return version_id


def test_historical_openapi_paths_and_operations_are_registered() -> None:
    frontend_schema = json.loads((Path(__file__).parents[2] / "frontend" / "openapi.json").read_text(encoding="utf-8"))
    actual = app.openapi()["paths"]
    assert set(frontend_schema["paths"]).issubset(actual)
    for path, methods in frontend_schema["paths"].items():
        for method, expected_operation in methods.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                assert method in actual[path]
                assert actual[path][method]["operationId"] == expected_operation["operationId"]
    assert "/api/v1/live-trading/orders" not in actual


def test_error_envelope_request_id_and_rbac(client: TestClient, headers) -> None:
    missing = client.get("/api/v1/datasets", headers={"X-Request-Id": "request-test"})
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "UNAUTHENTICATED"
    assert missing.json()["error"]["request_id"] == "request-test"
    assert missing.headers["X-Request-Id"] == "request-test"

    researcher = headers("researcher")
    malformed = client.post("/api/v1/datasets", json={"name": "only-name"}, headers=_headers("bad-dataset", researcher))
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "VALIDATION_ERROR"

    forbidden = client.get("/api/v1/audit-events", headers=researcher)
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"


def test_dataset_idempotency_quality_and_pit_query(client: TestClient, headers, worker) -> None:
    researcher = headers("researcher")
    sources = client.get("/api/v1/data-sources", headers=researcher)
    assert sources.status_code == 200
    source_id = _clean_source_id(client, researcher)

    payload = {"name": "Daily Bars", "market": "CN", "slug": "daily-bars"}
    first = client.post("/api/v1/datasets", json=payload, headers=_headers("dataset-key", researcher))
    assert first.status_code == 201
    dataset_id = first.json()["id"]
    replay = client.post("/api/v1/datasets", json=payload, headers=_headers("dataset-key", researcher))
    assert replay.status_code == 201
    assert replay.json()["id"] == dataset_id
    conflict = client.post("/api/v1/datasets", json=payload | {"name": "Different"}, headers=_headers("dataset-key", researcher))
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"

    version = client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        json={"data_source_id": source_id, "time_start": "2024-01-01", "time_end": "2024-01-31", "symbols": ["600000.SH"]},
        headers=_headers("version-key", researcher),
    )
    assert version.status_code == 202, version.text
    version_id = version.json()["dataset_version_id"]
    quality = client.post(
        f"/api/v1/dataset-versions/{version_id}/quality-runs",
        json={"rule_set_version": "local-quality-v1"},
        headers=_headers("quality-key", researcher),
    )
    assert quality.status_code == 202
    assert worker.process_until_idle() == 2
    query = client.post(
        f"/api/v1/dataset-versions/{version_id}/query",
        json={"start": "2024-01-01T00:00:00+08:00", "end": "2024-01-10T23:59:59+08:00", "columns": ["close"]},
        headers=researcher,
    )
    assert query.status_code == 200
    assert len(query.json()["items"]) == 10
    assert query.json()["page"] == {"has_more": False, "next_cursor": None}


def test_dataset_version_parent_lineage_and_iso_date_validation(client: TestClient, headers, worker) -> None:
    researcher = headers("researcher")
    source_id = _clean_source_id(client, researcher)
    dataset = client.post(
        "/api/v1/datasets",
        json={"name": "Lineage data", "market": "CN", "slug": "lineage-data"},
        headers=_headers("lineage-dataset", researcher),
    )
    assert dataset.status_code == 201, dataset.text
    dataset_id = dataset.json()["id"]
    base = client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        json={"data_source_id": source_id, "time_start": "2024-01-01", "time_end": "2024-01-31", "symbols": ["600000.SH"]},
        headers=_headers("lineage-base", researcher),
    )
    assert base.status_code == 202, base.text
    base_id = base.json()["dataset_version_id"]
    assert worker.process_until_idle() == 1
    child = client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        json={
            "data_source_id": source_id,
            "time_start": "2024-02-01",
            "time_end": "2024-02-29",
            "symbols": ["600000.SH"],
            "parent_version_id": base_id,
        },
        headers=_headers("lineage-child", researcher),
    )
    assert child.status_code == 202, child.text
    child_id = child.json()["dataset_version_id"]
    assert worker.process_until_idle() == 1
    child_detail = client.get(f"/api/v1/dataset-versions/{child_id}", headers=researcher)
    assert child_detail.status_code == 200
    assert child_detail.json()["parent_version_id"] == base_id
    assert child_detail.json()["manifest"]["parent_version_id"] == base_id
    lineage = client.get(f"/api/v1/dataset-versions/{child_id}/lineage", headers=researcher)
    assert lineage.status_code == 200
    assert {"parent_version_id": base_id, "child_version_id": child_id, "relation_type": "derived_from"} in lineage.json()["edges"]

    invalid_date = client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        json={"data_source_id": source_id, "time_start": "not-a-date", "time_end": "2024-03-01", "symbols": ["600000.SH"]},
        headers=_headers("lineage-invalid-date", researcher),
    )
    assert invalid_date.status_code == 422
    assert invalid_date.json()["error"]["code"] == "VALIDATION_ERROR"


def test_research_experiment_run_report_lifecycle_and_append_only_audit(client: TestClient, headers, worker) -> None:
    researcher = headers("researcher")
    source_id = _clean_source_id(client, researcher)
    dataset = client.post(
        "/api/v1/datasets",
        json={"name": "Experiment data", "market": "CN", "slug": "experiment-data"},
        headers=_headers("experiment-dataset", researcher),
    ).json()
    version = client.post(
        f"/api/v1/datasets/{dataset['id']}/versions",
        json={"data_source_id": source_id, "time_start": "2024-01-01", "time_end": "2024-02-01", "symbols": ["000001.SZ"]},
        headers=_headers("experiment-version", researcher),
    ).json()
    dataset_version_id = version["dataset_version_id"]
    assert client.post(
        f"/api/v1/dataset-versions/{dataset_version_id}/quality-runs",
        json={},
        headers=_headers("experiment-quality", researcher),
    ).status_code == 202
    assert worker.process_until_idle() == 2

    strategy_id = _container_and_frozen_version(client, researcher, "strategy")
    model_id = _container_and_frozen_version(client, researcher, "model")
    risk_id = _container_and_frozen_version(client, researcher, "risk_rule_set")
    protocol = {
        "contract_version": "experiment_protocol_v1",
        "name": "deterministic",
        "dataset_version_id": dataset_version_id,
        "strategy_version_id": strategy_id,
        "model_version_id": model_id,
        "risk_rule_version_id": risk_id,
        "seed": 7,
    }
    experiment = client.post("/api/v1/experiments", json=protocol, headers=_headers("experiment-key", researcher))
    assert experiment.status_code == 201, experiment.text
    experiment_id = experiment.json()["item"]["id"]
    run = client.post(
        f"/api/v1/experiments/{experiment_id}/runs",
        json={"on_duplicate": "reuse"},
        headers=_headers("run-key", researcher),
    )
    assert run.status_code == 202, run.text
    run_id = run.json()["item"]["id"]
    assert run.json()["item"]["status"] == "queued"
    assert worker.process_until_idle() == 1
    completed_run = client.get(f"/api/v1/runs/{run_id}", headers=researcher)
    assert completed_run.status_code == 200 and completed_run.json()["status"] == "success"
    assert client.get(f"/api/v1/runs/{run_id}/metrics", headers=researcher).json() == []
    assert client.get(f"/api/v1/runs/{run_id}/artifacts", headers=researcher).json()[0]["artifact_type"] == "run_manifest"

    cancelled_run = client.post(
        f"/api/v1/experiments/{experiment_id}/runs",
        json={"on_duplicate": "create_rerun"},
        headers=_headers("run-cancelled-key", researcher),
    )
    assert cancelled_run.status_code == 202
    cancelled_run_id = cancelled_run.json()["item"]["id"]
    cancelled_task_id = cancelled_run.json()["task"]["id"]
    cancellation = client.post(
        f"/api/v1/runs/{cancelled_run_id}/cancel",
        json={"reason": "test cancellation"},
        headers=_headers("run-cancel-key", researcher),
    )
    assert cancellation.status_code == 200 and cancellation.json()["item"]["status"] == "cancel_requested"
    assert worker.process_until_idle() == 1
    assert client.get(f"/api/v1/runs/{cancelled_run_id}", headers=researcher).json()["status"] == "canceled"
    assert client.get(f"/api/v1/tasks/{cancelled_task_id}", headers=researcher).json()["status"] == "canceled"
    assert client.get(f"/api/v1/runs/{cancelled_run_id}/artifacts", headers=researcher).json() == []

    content = {
        "contract_version": "report_content_v1",
        "title": "Recovered report",
        "data_cutoff": "2024-02-01",
        "applicable_universe": ["000001.SZ"],
        "prediction_horizon_days": 1,
        "blocks": [{"partition": "facts", "body_md": "No fabricated backtest result.", "model_version_sha256": "0" * 64, "sources": []}],
    }
    report = client.post(
        f"/api/v1/experiments/{experiment_id}/reports",
        json={"title": "Recovered report", "content": content, "run_ids": [run_id]},
        headers=_headers("report-key", researcher),
    )
    assert report.status_code == 201, report.text
    report_id = report.json()["item"]["id"]
    submit = client.post(f"/api/v1/reports/{report_id}/submit", json={"reason": "ready"}, headers=_headers("report-submit", researcher))
    assert submit.status_code == 200
    assert submit.json()["item"]["status"] == "submitted"
    admin = headers("admin")
    approved = client.post(f"/api/v1/reports/{report_id}/approve", json={"reason": "reviewed"}, headers=_headers("report-approve", admin))
    assert approved.status_code == 200
    assert approved.json()["item"]["status"] == "approved"
    content_response = client.get(f"/api/v1/reports/{report_id}/content", headers=researcher)
    assert content_response.json()["content_sha256"] == report.json()["item"]["content_sha256"]
    audit = client.get("/api/v1/audit-events", headers=headers("auditor"))
    assert audit.status_code == 200
    actions = [item["action"] for item in audit.json()["items"]]
    assert "report.create" in actions and "report.submit" in actions and "report.approve" in actions
