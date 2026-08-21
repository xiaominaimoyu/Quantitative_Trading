"""Runtime-contract audit independent of the frozen front-end export adapter."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from quant_trading.api.v1.endpoints.restored import _validate_validation_protocol
from quant_trading.config import settings
from quant_trading.core.database import get_db
from quant_trading.core.errors import APIError
from quant_trading.main import app as runtime_app
from quant_trading.models.recovery import PaperOrder, ReconciliationRun


def _auth(client: TestClient, login_name: str, role: str = "researcher") -> dict[str, str]:
    response = client.post("/api/v1/auth/dev-session", json={"login_name": login_name, "role": role})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def _key(auth: dict[str, str], key: str) -> dict[str, str]:
    return auth | {"Idempotency-Key": key}


def _create_dataset_version(client: TestClient, auth: dict[str, str], worker, stem: str = "runtime") -> str:
    source = client.get("/api/v1/data-sources", headers=auth)
    assert source.status_code == 200, source.text
    created = client.post(
        "/api/v1/datasets",
        json={"slug": f"{stem}-dataset", "name": f"{stem} dataset", "market": "CN"},
        headers=_key(auth, f"{stem}-dataset"),
    )
    assert created.status_code == 201, created.text
    version = client.post(
        f"/api/v1/datasets/{created.json()['id']}/versions",
        json={
            "data_source_id": next(item["id"] for item in source.json()["items"] if item["name"] == "Deterministic fixture (clean)"),
            "time_start": "2024-01-01",
            "time_end": "2024-01-31",
            "symbols": ["600000.SH"],
        },
        headers=_key(auth, f"{stem}-dataset-version"),
    )
    assert version.status_code == 202, version.text
    version_id = version.json()["dataset_version_id"]
    quality = client.post(
        f"/api/v1/dataset-versions/{version_id}/quality-runs",
        json={"rule_set_version": "runtime-audit"},
        headers=_key(auth, f"{stem}-quality"),
    )
    assert quality.status_code == 202, quality.text
    assert worker.process_until_idle() == 2
    return version_id


def _frozen_version(client: TestClient, auth: dict[str, str], kind: str, stem: str) -> tuple[str, str]:
    plural = {"strategy": "strategies", "model": "models", "risk_rule_set": "risk-rule-sets"}[kind]
    version_root = {"strategy": "strategy-versions", "model": "model-versions", "risk_rule_set": "risk-rule-versions"}[kind]
    container = client.post(
        f"/api/v1/{plural}",
        json={"slug": f"{stem}-{kind}", "name": f"{stem} {kind}"},
        headers=_key(auth, f"{stem}-{kind}-container"),
    )
    assert container.status_code == 201, container.text
    container_id = container.json()["item"]["id"]
    version = client.post(
        f"/api/v1/{plural}/{container_id}/versions",
        json={"content": {"contract_version": "runtime_v1", "kind": kind}},
        headers=_key(auth, f"{stem}-{kind}-version"),
    )
    assert version.status_code == 201, version.text
    version_id = version.json()["item"]["id"]
    frozen = client.post(
        f"/api/v1/{version_root}/{version_id}/freeze",
        json={"reason": "runtime contract audit"},
        headers=_key(auth, f"{stem}-{kind}-freeze"),
    )
    assert frozen.status_code == 200, frozen.text
    assert frozen.json()["item"]["status"] == "frozen"
    return container_id, version_id


def _experiment(client: TestClient, auth: dict[str, str], worker, stem: str = "runtime") -> dict[str, Any]:
    dataset_version_id = _create_dataset_version(client, auth, worker, stem)
    _, strategy_version_id = _frozen_version(client, auth, "strategy", stem)
    _, model_version_id = _frozen_version(client, auth, "model", stem)
    _, risk_version_id = _frozen_version(client, auth, "risk_rule_set", stem)
    payload = {
        "contract_version": "experiment_protocol_v1",
        "name": f"{stem} experiment",
        "dataset_version_id": dataset_version_id,
        "strategy_version_id": strategy_version_id,
        "model_version_id": model_version_id,
        "risk_rule_version_id": risk_version_id,
        "seed": 7,
    }
    response = client.post("/api/v1/experiments", json=payload, headers=_key(auth, f"{stem}-experiment"))
    assert response.status_code == 201, response.text
    return response.json()["item"]


def _report_content(title: str = "runtime report") -> dict[str, Any]:
    return {
        "contract_version": "report_content_v1",
        "title": title,
        "data_cutoff": "2024-02-01",
        "applicable_universe": ["600000.SH"],
        "prediction_horizon_days": 1,
        "blocks": [
            {
                "partition": "facts",
                "body_md": "<script>must not execute</script>",
                "model_version_sha256": "0" * 64,
                "sources": [],
            }
        ],
    }


def _report(client: TestClient, auth: dict[str, str], experiment_id: str, stem: str = "runtime") -> str:
    response = client.post(
        f"/api/v1/experiments/{experiment_id}/reports",
        json={"title": f"{stem} <script>alert(1)</script>", "content": _report_content(), "run_ids": []},
        headers=_key(auth, f"{stem}-report"),
    )
    assert response.status_code == 201, response.text
    return response.json()["item"]["id"]


def _parameter(operation: dict[str, Any], name: str) -> dict[str, Any]:
    return next(item for item in operation["parameters"] if item["name"] == name)


def test_runtime_openapi_contract_audit_and_real_http_domain_shapes(client: TestClient, worker) -> None:
    """Audit the real ASGI app; never import the frozen artifact exporter."""

    runtime_schema = runtime_app.openapi()
    frozen_schema = json.loads((Path(__file__).parents[2] / "frontend" / "openapi.json").read_text(encoding="utf-8"))
    for path, expected_item in frozen_schema["paths"].items():
        assert path in runtime_schema["paths"]
        for method, expected_operation in expected_item.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            actual_operation = runtime_schema["paths"][path][method]
            assert actual_operation["operationId"] == expected_operation["operationId"]

    components = runtime_schema["components"]
    assert "BearerAuth" in components["securitySchemes"]
    assert runtime_schema["paths"]["/api/v1/auth/me"]["get"]["security"] == [{"BearerAuth": []}]
    assert runtime_schema["paths"]["/api/v1/paper-trading/stop"]["post"]["security"] == [{"BearerAuth": []}]
    assert set(components["schemas"]["DevSessionRequest"]["required"]) == {"login_name", "role"}
    assert components["schemas"]["PaperStopRequest"]["properties"]["account_id"]["anyOf"][0]["format"] == "uuid"
    assert runtime_schema["paths"]["/api/v1/auth/dev-session"]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"] == "#/components/schemas/DevSessionRequest"
    assert runtime_schema["paths"]["/api/v1/paper-trading/stop"]["post"]["requestBody"]["content"]["application/json"]["schema"]["anyOf"][0]["$ref"] == "#/components/schemas/PaperStopRequest"
    paper_response_refs = {
        "/api/v1/paper-trading/snapshot": "PaperSnapshotResponse",
        "/api/v1/paper-trading/stop": "PaperStopResponse",
        "/api/v1/paper-trading/orders": "PaperOrdersResponse",
        "/api/v1/paper-trading/orders/{order_id}": "PaperOrderResponse",
        "/api/v1/paper-trading/reconciliations": "PaperReconciliationsResponse",
        "/api/v1/paper-trading/reconciliations/{run_id}": "PaperReconciliationDetailResponse",
        "/api/v1/paper-trading/daily-report": "PaperDailyReportResponse",
    }
    for path, schema_name in paper_response_refs.items():
        operation = next(iter(runtime_schema["paths"][path].values()))
        response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
        assert response_schema["$ref"] == f"#/components/schemas/{schema_name}"
    paper_order_operation = runtime_schema["paths"]["/api/v1/paper-trading/orders/{order_id}"]["get"]
    assert _parameter(paper_order_operation, "order_id")["schema"]["format"] == "uuid"
    assert _parameter(runtime_schema["paths"]["/api/v1/datasets/{dataset_id}"]["get"], "dataset_id")["schema"]["format"] == "uuid"
    assert _parameter(runtime_schema["paths"]["/api/v1/strategy-versions/{version_id}/freeze"]["post"], "version_id")["schema"]["format"] == "uuid"
    assert _parameter(runtime_schema["paths"]["/api/v1/runs/{run_id}"]["get"], "run_id")["schema"]["format"] == "uuid"
    assert _parameter(runtime_schema["paths"]["/api/v1/reports/{report_id}"]["get"], "report_id")["schema"]["format"] == "uuid"
    daily_report_operation = runtime_schema["paths"]["/api/v1/paper-trading/daily-report"]["get"]
    date_parameter_schema = _parameter(daily_report_operation, "date")["schema"]
    assert any(item.get("format") == "date" for item in date_parameter_schema["anyOf"])
    assert _parameter(runtime_schema["paths"]["/api/v1/paper-trading/orders"]["get"], "page_size")["schema"]["maximum"] == 100
    account_properties = components["schemas"]["PaperAccountResponse"]["properties"]
    assert {"total", "available", "market_value", "day_pnl", "day_pnl_pct"}.issubset(account_properties)
    position_properties = components["schemas"]["PaperPositionResponse"]["properties"]
    assert {"name", "pnl", "pnl_pct"}.issubset(position_properties)
    order_price_schema = components["schemas"]["PaperOrderResponse"]["properties"]["price"]
    assert any(item.get("type") == "null" for item in order_price_schema["anyOf"])
    reconciliation_properties = components["schemas"]["PaperReconciliationResponse"]["properties"]
    assert {"status", "result_status", "execution_status"}.issubset(reconciliation_properties)
    dataset_create_schema = components["schemas"]["DatasetCreate"]
    version_create_schema = components["schemas"]["DatasetVersionCreate"]
    row_query_schema = components["schemas"]["RowQueryRequest"]
    aggregate_schema = components["schemas"]["AggregateRequest"]
    assert dataset_create_schema["properties"]["name"]["minLength"] == 1
    assert version_create_schema["properties"]["symbols"]["maxItems"] == 1000
    assert version_create_schema["properties"]["symbols"]["items"]["pattern"] == "^[A-Za-z0-9._-]+$"
    assert version_create_schema["properties"]["timezone"]["const"] == "Asia/Shanghai"
    assert row_query_schema["properties"]["start"]["format"] == "date-time"
    assert row_query_schema["properties"]["limit"]["maximum"] == 100
    assert aggregate_schema["properties"]["max_points"]["maximum"] == 1000
    assert runtime_schema["paths"]["/api/v1/datasets"]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"] == "#/components/schemas/DatasetCreate"
    assert runtime_schema["paths"]["/api/v1/dataset-versions/{version_id}/query"]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"] == "#/components/schemas/RowQueryRequest"

    researcher = _auth(client, "runtime-researcher")
    me = client.get("/api/v1/auth/me", headers=researcher)
    assert me.status_code == 200 and me.json()["login_name"] == "runtime-researcher"
    experiment = _experiment(client, researcher, worker)
    run = client.post(
        f"/api/v1/experiments/{experiment['id']}/runs",
        json={"on_duplicate": "reuse"},
        headers=_key(researcher, "runtime-run"),
    )
    assert run.status_code == 202 and {"item", "task", "outcome"}.issubset(run.json())
    assert worker.process_until_idle() == 1
    validation = client.post(
        f"/api/v1/experiments/{experiment['id']}/validation-runs",
        json={
            "protocol": {
                "walk_forward_windows": [
                    {
                        "train": {"start_date": "2024-01-01", "end_date": "2024-01-05"},
                        "validation": {"start_date": "2024-01-05", "end_date": "2024-01-10"},
                        "holdout": {"start_date": "2024-01-10", "end_date": "2024-01-15"},
                    }
                ],
                "seeds": [7],
                "stress_scenarios": [{"name": "base"}],
            }
        },
        headers=_key(researcher, "runtime-validation"),
    )
    assert validation.status_code == 202 and validation.json()["item"]["created_count"] == 1
    risk = client.post(
        "/api/v1/risk-events",
        json={"experiment_id": experiment["id"], "payload": {"contract_version": "v1", "reason_code": "RISK", "symbol": "600000.SH", "trade_date": "2024-01-15"}},
        headers=_key(researcher, "runtime-risk"),
    )
    assert risk.status_code == 201 and risk.json()["item"]["reason_code"] == "RISK"
    report_id = _report(client, researcher, experiment["id"])
    assert client.get(f"/api/v1/reports/{report_id}/content", headers=researcher).json()["content_sha256"]
    auditor = _auth(client, "runtime-auditor", "auditor")
    assert client.get("/api/v1/audit-events", headers=auditor).status_code == 200

    snapshot = client.get("/api/v1/paper-trading/snapshot", headers=researcher)
    assert snapshot.status_code == 200 and {"status", "account", "positions", "orders"}.issubset(snapshot.json())
    account_id = snapshot.json()["account"]["id"]
    orders = client.get("/api/v1/paper-trading/orders", params={"account_id": account_id, "page": 1, "page_size": 20}, headers=researcher)
    assert orders.status_code == 200 and {"items", "page"}.issubset(orders.json())
    daily = client.get("/api/v1/paper-trading/daily-report", params={"account_id": account_id, "date": "2024-01-01"}, headers=researcher)
    assert daily.status_code == 200 and {"day_pnl", "filled_orders_count", "total_fees"}.issubset(daily.json())
    admin = _auth(client, "runtime-admin", "admin")
    stopped = client.post("/api/v1/paper-trading/stop", json={"reason": "runtime audit"}, headers=_key(admin, "runtime-stop"))
    assert stopped.status_code == 200 and stopped.json()["account"]["status"] == "stopped"


def test_runtime_paper_http_uses_fixed_decimal_strings_null_market_price_and_reconciliation_shape(
    client: TestClient, session_factory
) -> None:
    researcher = _auth(client, "paper-runtime-researcher")
    snapshot = client.get("/api/v1/paper-trading/snapshot", headers=researcher)
    assert snapshot.status_code == 200, snapshot.text
    account_id = snapshot.json()["account"]["id"]

    db = session_factory()
    try:
        order = PaperOrder(
            account_id=account_id,
            client_order_id="runtime-market-order",
            symbol="600000.SH",
            exchange="SH",
            side="buy",
            order_type="market",
            quantity=Decimal("3.25"),
            price=None,
            filled_quantity=Decimal("0"),
            status="submitted",
        )
        run = ReconciliationRun(
            account_id=account_id,
            status="completed",
            result_status="difference",
            discrepancies=[{"target": "order:runtime-market-order", "type": "difference", "summary": "observed only"}],
            checked_targets_count=2,
            differences_count=1,
        )
        db.add_all([order, run])
        db.commit()
        db.refresh(order)
        db.refresh(run)
    finally:
        db.close()

    refreshed_snapshot = client.get("/api/v1/paper-trading/snapshot", params={"account_id": account_id}, headers=researcher)
    assert refreshed_snapshot.status_code == 200, refreshed_snapshot.text
    account = refreshed_snapshot.json()["account"]
    assert all(isinstance(account[field], str) for field in ("total", "available", "market_value", "day_pnl", "day_pnl_pct"))

    orders = client.get("/api/v1/paper-trading/orders", params={"account_id": account_id, "page": 1}, headers=researcher)
    assert orders.status_code == 200, orders.text
    wire_order = orders.json()["items"][0]
    assert wire_order["price"] is None
    assert isinstance(wire_order["quantity"], str)
    assert isinstance(wire_order["filled_quantity"], str)
    assert wire_order["submitted_at"] is None

    daily = client.get("/api/v1/paper-trading/daily-report", params={"account_id": account_id, "date": "2024-01-01"}, headers=researcher)
    assert daily.status_code == 200, daily.text
    assert all(isinstance(daily.json()[field], str) for field in ("day_pnl", "day_pnl_pct", "turnover", "total_fees"))

    listed = client.get("/api/v1/paper-trading/reconciliations", params={"account_id": account_id, "page": 1}, headers=researcher)
    assert listed.status_code == 200, listed.text
    listed_run = listed.json()["items"][0]
    assert listed_run["status"] == "completed"
    assert listed_run["result_status"] == "difference"
    assert listed_run["execution_status"] == "completed"
    assert listed_run["checked_targets_count"] == 2
    assert listed_run["differences_count"] == 1

    detail = client.get(f"/api/v1/paper-trading/reconciliations/{run.id}", headers=researcher)
    assert detail.status_code == 200, detail.text
    assert detail.json()["run"]["result_status"] == "difference"
    assert detail.json()["items"] == [{"target": "order:runtime-market-order", "type": "difference", "summary": "observed only"}]

    malformed_uuid = client.get("/api/v1/datasets/not-a-uuid", headers=researcher)
    assert malformed_uuid.status_code == 422
    assert malformed_uuid.json()["error"]["code"] == "VALIDATION_ERROR"


def test_owner_checks_and_admin_override(client: TestClient, worker) -> None:
    alice = _auth(client, "alice")
    bob = _auth(client, "bob")
    admin = _auth(client, "owner-admin", "admin")
    container_id, draft_version_id = _frozen_version(client, alice, "strategy", "owner")
    draft = client.post(
        f"/api/v1/strategies/{container_id}/versions",
        json={"content": {"contract_version": "v1", "name": "draft"}},
        headers=_key(alice, "owner-draft"),
    )
    assert draft.status_code == 201
    draft_version_id = draft.json()["item"]["id"]
    assert client.post(
        f"/api/v1/strategies/{container_id}/versions",
        json={"content": {"contract_version": "v1"}},
        headers=_key(bob, "bob-version"),
    ).status_code == 403
    assert client.post(
        f"/api/v1/strategy-versions/{draft_version_id}/freeze",
        json={"reason": "not owner"},
        headers=_key(bob, "bob-freeze"),
    ).status_code == 403
    assert client.post(
        f"/api/v1/strategy-versions/{draft_version_id}/deprecate",
        json={"reason": "not owner"},
        headers=_key(bob, "bob-deprecate"),
    ).status_code == 403
    assert client.post(
        f"/api/v1/strategy-versions/{draft_version_id}/freeze",
        json={"reason": "admin override"},
        headers=_key(admin, "admin-freeze"),
    ).status_code == 200

    experiment = _experiment(client, alice, worker, "owner-experiment")
    assert client.post(
        f"/api/v1/experiments/{experiment['id']}/runs",
        json={},
        headers=_key(bob, "bob-run"),
    ).status_code == 403
    assert client.post(
        f"/api/v1/experiments/{experiment['id']}/runs",
        json={},
        headers=_key(admin, "admin-run"),
    ).status_code == 202
    report_id = _report(client, alice, experiment["id"], "owner-report")
    assert client.post(f"/api/v1/reports/{report_id}/submit", json={"reason": "not owner"}, headers=_key(bob, "bob-submit")).status_code == 403
    assert client.post(f"/api/v1/reports/{report_id}/deprecate", json={"reason": "not owner"}, headers=_key(bob, "bob-deprecate-report")).status_code == 403


def test_validation_protocol_rejects_phase_leakage_invalid_dates_and_overlapping_windows() -> None:
    base = {
        "walk_forward_windows": [
            {
                "train": {"start_date": "2024-01-01", "end_date": "2024-01-05"},
                "validation": {"start_date": "2024-01-05", "end_date": "2024-01-11"},
                "holdout": {"start_date": "2024-01-10", "end_date": "2024-01-15"},
            }
        ],
        "seeds": [1],
        "stress_scenarios": [{"name": "base"}],
    }
    with pytest.raises(APIError) as leakage:
        _validate_validation_protocol(base)
    assert leakage.value.code == "FUTURE_DATA_LEAKAGE"
    invalid_date = json.loads(json.dumps(base))
    invalid_date["walk_forward_windows"][0]["validation"]["end_date"] = "not-a-date"
    with pytest.raises(APIError) as malformed:
        _validate_validation_protocol(invalid_date)
    assert malformed.value.code == "VALIDATION_PROTOCOL_INVALID"
    overlapping = {
        "walk_forward_windows": [
            {
                "train": {"start_date": "2024-01-01", "end_date": "2024-01-02"},
                "validation": {"start_date": "2024-01-02", "end_date": "2024-01-03"},
                "holdout": {"start_date": "2024-01-03", "end_date": "2024-01-04"},
            },
            {
                "train": {"start_date": "2024-01-04", "end_date": "2024-01-05"},
                "validation": {"start_date": "2024-01-05", "end_date": "2024-01-06"},
                "holdout": {"start_date": "2024-01-06", "end_date": "2024-01-07"},
            },
        ],
        "seeds": [1],
        "stress_scenarios": [{"name": "base"}],
    }
    with pytest.raises(APIError) as overlap:
        _validate_validation_protocol(overlapping)
    assert overlap.value.code == "OVERLAPPING_WINDOWS"


def test_dev_session_production_gate_required_idempotency_and_report_exports(client: TestClient, worker, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "DEV_SESSION_ENABLED", None)
    disabled = client.post("/api/v1/auth/dev-session", json={"login_name": "no-admin", "role": "admin"})
    assert disabled.status_code == 404 and disabled.json()["error"]["code"] == "DEV_SESSION_DISABLED"
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")

    researcher = _auth(client, "idempotency-researcher")
    admin = _auth(client, "idempotency-admin", "admin")
    risk_payload = {"payload": {"contract_version": "v1", "reason_code": "RISK", "symbol": "600000.SH", "trade_date": "2024-01-15"}}
    assert client.post("/api/v1/risk-events", json=risk_payload, headers=researcher).status_code == 422
    first_risk = client.post("/api/v1/risk-events", json=risk_payload, headers=_key(researcher, "risk-replay"))
    replay_risk = client.post("/api/v1/risk-events", json=risk_payload, headers=_key(researcher, "risk-replay"))
    assert first_risk.status_code == replay_risk.status_code == 201
    assert first_risk.json()["item"]["id"] == replay_risk.json()["item"]["id"]
    conflict_risk = client.post("/api/v1/risk-events", json={"payload": risk_payload["payload"] | {"reason_code": "OTHER"}}, headers=_key(researcher, "risk-replay"))
    assert conflict_risk.status_code == 409
    assert client.post("/api/v1/paper-trading/stop", json={"reason": "missing key"}, headers=admin).status_code == 422

    experiment = _experiment(client, researcher, worker, "export")
    report_id = _report(client, researcher, experiment["id"], "export")
    assert client.post(f"/api/v1/reports/{report_id}/submit", json={"reason": "missing key"}, headers=researcher).status_code == 422
    exported_json = client.post(f"/api/v1/reports/{report_id}/export", json={"format": "json"}, headers=_key(researcher, "export-json"))
    assert exported_json.status_code == 200
    artifact = client.get(f"/api/v1/artifacts/{exported_json.json()['artifact_id']}/download", headers=researcher)
    assert artifact.headers["content-type"].startswith("application/json")
    assert "attachment; filename=\"artifact-" in artifact.headers["content-disposition"]
    assert json.loads(artifact.text)["contract_version"] == "report_content_v1"
    exported_html = client.post(f"/api/v1/reports/{report_id}/export", json={"format": "html"}, headers=_key(researcher, "export-html"))
    html_artifact = client.get(f"/api/v1/artifacts/{exported_html.json()['artifact_id']}/download", headers=researcher)
    assert "<script>" not in html_artifact.text and "&lt;script&gt;" in html_artifact.text
    exported_markdown = client.post(f"/api/v1/reports/{report_id}/export", json={"format": "markdown"}, headers=_key(researcher, "export-markdown"))
    markdown_artifact = client.get(f"/api/v1/artifacts/{exported_markdown.json()['artifact_id']}/download", headers=researcher)
    assert "<script>" not in markdown_artifact.text and "&lt;script&gt;" in markdown_artifact.text


def test_readiness_checks_the_request_time_database_and_hides_driver_details(client: TestClient) -> None:
    assert client.get("/api/v1/health/ready").status_code == 200

    class BrokenSession:
        def execute(self, _statement: object) -> None:
            raise OperationalError("SELECT 1", {}, RuntimeError("connection detail must not leak"))

    app_overrides = runtime_app.dependency_overrides
    previous = app_overrides.get(get_db)
    app_overrides[get_db] = lambda: BrokenSession()
    try:
        response = client.get("/api/v1/health/ready")
    finally:
        if previous is None:
            app_overrides.pop(get_db, None)
        else:
            app_overrides[get_db] = previous
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "NOT_READY"
    assert "connection detail" not in response.text
