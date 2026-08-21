"""Recovered B0--B5 API routes backed by deterministic local persistence.

This module restores the retained 68-path contract without claiming that the
lost implementation was recovered byte-for-byte.  It contains no market-data,
broker, xtquant, worker, or real-money integration.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from datetime import date as calendar_date, datetime, timezone
from decimal import Decimal
from html import escape
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, Path, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import AfterValidator
from sqlalchemy import desc, func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from quant_trading.config import settings
from quant_trading.core.auth import Actor, get_current_actor, issue_dev_token, require_admin, require_scope
from quant_trading.core.errors import public_error
from quant_trading.core.database import get_db
from quant_trading.execution.orders import OrderStatus
from quant_trading.execution.report import daily_report, paper_positions
from quant_trading.execution.safety import KillSwitch
from quant_trading.models.recovery import (
    Artifact,
    AuditEvent,
    DataQualityRun,
    DataSource,
    Dataset,
    DatasetVersion,
    Experiment,
    PaperAccount,
    PaperFill,
    PaperOrder,
    ReconciliationRun,
    Report,
    ReportRunLink,
    ResearchContainer,
    ResearchVersion,
    RiskEvent,
    Run,
    Task,
    ValidationRun,
    new_id,
    utcnow,
)
from quant_trading.schemas.runtime_contract import (
    AggregateRequest,
    AuthMeResponse,
    DatasetCreate,
    DatasetVersionCreate,
    DevSessionRequest,
    DevSessionResponse,
    PaperAccountResponse,
    PaperDailyReportResponse,
    PaperOrderResponse,
    PaperOrdersResponse,
    PaperReconciliationDetailResponse,
    PaperReconciliationResponse,
    PaperReconciliationsResponse,
    PaperSnapshotResponse,
    PaperStopRequest,
    PaperStopResponse,
    RowQueryRequest,
    TaskCreate,
)
from quant_trading.services.recovery import (
    append_audit,
    content_hash,
    cursor_page_response,
    execute_idempotent,
    jsonable,
    page_response,
)
from quant_trading.services.snapshot_store import SnapshotStore, SnapshotStoreError
from quant_trading.services.task_queue import online_workers, task_counts


router = APIRouter()
_UUID_PATH_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _validate_uuid_path(value: str) -> str:
    """Keep path handlers string-based while rejecting malformed UUID paths."""

    if not _UUID_PATH_PATTERN.fullmatch(value):
        raise ValueError("must be a UUID")
    return value


UUIDPath = Annotated[
    str,
    Path(json_schema_extra={"format": "uuid"}),
    AfterValidator(_validate_uuid_path),
]


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "request-unknown"))


def _json(content: Any, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=jsonable(content), status_code=status_code)


def _commit_json(db: Session, content: Any, status_code: int = 200) -> JSONResponse:
    db.commit()
    return _json(content, status_code)


def _validated_paper_payload(model: Any, content: dict[str, Any]) -> dict[str, Any]:
    """Validate a paper API payload before it crosses the JSON boundary."""

    return model.model_validate(content).model_dump(mode="json")


def _validated_paper_commit_json(db: Session, model: Any, content: dict[str, Any], status_code: int = 200) -> JSONResponse:
    return _commit_json(db, _validated_paper_payload(model, content), status_code)


def _required_string(body: dict[str, Any], field: str) -> str:
    value = body.get(field)
    if not isinstance(value, str) or not value.strip():
        raise public_error(422, "VALIDATION_ERROR", f"{field} is required")
    return value.strip()


def _required_object(body: dict[str, Any], field: str) -> dict[str, Any]:
    value = body.get(field)
    if not isinstance(value, dict):
        raise public_error(422, "VALIDATION_ERROR", f"{field} must be an object")
    return value


def _lookup(db: Session, model: type[Any], resource_id: str, code: str = "NOT_FOUND") -> Any:
    value = db.get(model, str(resource_id))
    if value is None:
        raise public_error(404, code, "Resource was not found")
    return value


def _require_owner(actor: Actor, owner_key: str) -> None:
    """Allow an administrator to act across owners, never a researcher."""

    if actor.role != "admin" and actor.key != owner_key:
        raise public_error(403, "OWNER_FORBIDDEN", "This operation is limited to the resource owner or an administrator")


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:110] or f"dataset-{content_hash(value)[:12]}"


def _snapshot_store() -> SnapshotStore:
    """Construct storage access lazily; imports and GET endpoints do not initialize it."""

    return SnapshotStore(artifact_root=settings.ARTIFACT_ROOT, data_root=settings.DATA_ROOT)


def _page_args(page: int, page_size: int) -> tuple[int, int]:
    if page < 1:
        raise public_error(422, "INVALID_PAGE", "page must be at least 1")
    if page_size < 1 or page_size > 100:
        raise public_error(422, "INVALID_PAGE_SIZE", "page_size must be between 1 and 100")
    return page, page_size


def _data_source_out(source: DataSource) -> dict[str, Any]:
    return {"id": source.id, "name": source.name, "adapter": source.adapter, "license_ref": source.license_ref, "status": source.status}


def _quality_gate(version: DatasetVersion | None) -> tuple[bool, str | None, list[str]]:
    if version is None:
        return False, "not_eligible", ["no_dataset_version"]
    reasons: list[str] = []
    if version.status != "available":
        reasons.append(f"version_status:{version.status}")
    if version.quality_status not in {"passed", "warning"}:
        reasons.append(f"quality_status:{version.quality_status}")
    return not reasons, "eligible" if not reasons else "not_eligible", reasons


def _source_name(value: dict[str, Any] | str | None) -> str | None:
    if isinstance(value, dict):
        name = value.get("name")
        return name if isinstance(name, str) else None
    return value if isinstance(value, str) else None


def _quality_summary_text(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        summary = value.get("summary")
        if isinstance(summary, str):
            return summary
        return "; ".join(f"{key}={item}" for key, item in sorted(value.items())) or None
    return str(value)


def _time_range_text(start: str | None, end: str | None) -> str | None:
    if not start or not end:
        return None
    return f"{start} ~ {end}"


def _dataset_version_out(db: Session, version: DatasetVersion, *, detail: bool = False) -> dict[str, Any]:
    eligible, decision, reasons = _quality_gate(version)
    output: dict[str, Any] = {
        "id": version.id,
        "dataset_id": version.dataset_id,
        "version_no": version.version_no,
        "status": version.status,
        "quality_status": version.quality_status,
        "quality_summary": _quality_summary_text(version.quality_summary),
        "time_start": version.time_start,
        "time_end": version.time_end,
        "time_range": _time_range_text(version.time_start, version.time_end),
        "row_count": version.row_count,
        "parent_version_id": version.parent_version_id,
        "data_source_id": version.data_source_id,
        "source": _source_name(version.source),
        "task_id": version.task_id,
        "timezone": version.timezone,
        "adjustment": version.adjustment,
        "manifest_sha256": version.manifest_sha256,
        "logical_content_sha256": version.logical_content_sha256,
        "eligible_for_formal_use": eligible,
        "gate_decision": decision,
        "gate_reasons": reasons,
        "created_at": version.created_at,
    }
    if detail:
        output["manifest"] = version.manifest
        latest_quality = db.scalar(
            select(DataQualityRun)
            .where(DataQualityRun.version_id == version.id)
            .order_by(desc(DataQualityRun.created_at), desc(DataQualityRun.id))
            .limit(1)
        )
        output["latest_quality_run"] = _quality_run_out(latest_quality) if latest_quality else None
    return output


def _dataset_out(db: Session, dataset: Dataset, *, detail: bool = False) -> dict[str, Any]:
    latest = db.scalar(
        select(DatasetVersion)
        .where(DatasetVersion.dataset_id == dataset.id)
        .order_by(desc(DatasetVersion.version_no))
        .limit(1)
    )
    eligible, decision, reasons = _quality_gate(latest)
    output: dict[str, Any] = {
        "id": dataset.id,
        "slug": dataset.slug,
        "name": dataset.name,
        "market": dataset.market,
        "frequency": dataset.frequency,
        "schema_version": dataset.schema_version,
        "license": dataset.license,
        "status": dataset.status,
        "latest_version_id": latest.id if latest else None,
        "latest_version_no": latest.version_no if latest else None,
        "latest_version_status": latest.status if latest else None,
        "latest_quality_status": latest.quality_status if latest else None,
        "latest_logical_content_sha256": latest.logical_content_sha256 if latest else None,
        "time_range": _time_range_text(latest.time_start, latest.time_end) if latest else None,
        "row_count": latest.row_count if latest else 0,
        "source_id": latest.data_source_id if latest else None,
        "source": _source_name(latest.source) if latest else None,
        "eligible_for_formal_use": eligible,
        "gate_decision": decision,
        "gate_reasons": reasons,
        "created_at": dataset.created_at,
        "updated_at": dataset.updated_at,
    }
    if detail:
        versions = db.scalars(
            select(DatasetVersion).where(DatasetVersion.dataset_id == dataset.id).order_by(desc(DatasetVersion.version_no))
        ).all()
        output["versions"] = [_dataset_version_out(db, version) for version in versions]
    return output


def _task_out(task: Task) -> dict[str, Any]:
    return {
        "id": task.id,
        "task_type": task.task_type,
        "status": task.status,
        "owner_key": task.owner_key,
        "priority": task.priority,
        "attempt_count": task.attempt_count,
        "max_attempts": task.max_attempts,
        "progress": task.progress,
        "run_id": task.run_id,
        "error_code": task.error_code,
        "error_message": task.error_message,
        "cancel_requested_at": task.cancel_requested_at,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "completed_at": task.completed_at,
    }


def _quality_run_out(value: DataQualityRun) -> dict[str, Any]:
    return {
        "id": value.id,
        "version_id": value.version_id,
        "task_id": value.task_id,
        "rule_set_version": value.rule_set_version,
        "status": value.status,
        "blocking_count": value.blocking_count,
        "warning_count": value.warning_count,
        "report_artifact_id": value.report_artifact_id,
        "results": value.results,
        "created_at": value.created_at,
        "completed_at": value.completed_at,
    }


def _lineage_out(db: Session, version: DatasetVersion) -> dict[str, Any]:
    values = db.scalars(select(DatasetVersion).where(DatasetVersion.dataset_id == version.dataset_id).order_by(DatasetVersion.version_no)).all()
    committed_ids = {item.id for item in values if item.status == "available" and item.quality_status == "passed"}
    return {
        "nodes": [{"id": item.id, "dataset_id": item.dataset_id, "version_no": item.version_no, "status": item.status} for item in values],
        "edges": [
            {"parent_version_id": item.parent_version_id, "child_version_id": item.id, "relation_type": "derived_from"}
            for item in values
            if item.parent_version_id and item.id in committed_ids and item.parent_version_id in committed_ids
        ],
    }


def _container_out(db: Session, container: ResearchContainer) -> dict[str, Any]:
    latest = db.scalar(
        select(ResearchVersion)
        .where(ResearchVersion.container_id == container.id)
        .order_by(desc(ResearchVersion.version_no))
        .limit(1)
    )
    return {
        "id": container.id,
        "slug": container.slug,
        "name": container.name,
        "description": container.description,
        "owner_key": container.owner_key,
        "version_count": db.scalar(select(func.count()).select_from(ResearchVersion).where(ResearchVersion.container_id == container.id)) or 0,
        "latest_version_id": latest.id if latest else None,
        "latest_version_no": latest.version_no if latest else None,
        "latest_version_status": latest.status if latest else None,
        "created_at": container.created_at,
        "updated_at": container.updated_at,
    }


def _version_out(version: ResearchVersion) -> dict[str, Any]:
    owner_field = {
        "strategy": "strategy_id",
        "model": "model_id",
        "risk_rule_set": "risk_rule_set_id",
    }[version.container_type]
    output = {
        "id": version.id,
        "version_no": version.version_no,
        "status": version.status,
        "content_sha256": version.content_sha256,
        "eligible_for_new_experiment": version.status == "frozen",
        "parent_version_id": version.parent_version_id,
        "note": version.note,
        "created_by_key": version.created_by_key,
        "created_at": version.created_at,
        "frozen_at": version.frozen_at,
        "frozen_by_key": version.frozen_by_key,
        "freeze_reason": version.freeze_reason,
        "deprecated_at": version.deprecated_at,
        "deprecated_by_key": version.deprecated_by_key,
        "deprecate_reason": version.deprecate_reason,
        "contract_name": version.contract_name,
        "content": version.content,
    }
    output[owner_field] = version.container_id
    return output


def _mutation(db: Session, *, actor: Actor, operation: str, key: str, payload: Any, handler: Any) -> JSONResponse:
    value, status_code, _ = execute_idempotent(
        db,
        actor_key=actor.key,
        operation=operation,
        key=key,
        payload=payload,
        handler=handler,
    )
    return _json(value, status_code)


def _create_container(
    db: Session,
    *,
    kind: str,
    body: dict[str, Any],
    actor: Actor,
    request: Request,
    key: str,
) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        slug = _required_string(body, "slug")
        name = _required_string(body, "name")
        if db.scalar(select(ResearchContainer).where(ResearchContainer.container_type == kind, ResearchContainer.slug == slug)):
            raise public_error(409, "DUPLICATE_SLUG", "A container with this slug already exists")
        container = ResearchContainer(
            container_type=kind,
            slug=slug,
            name=name,
            description=body.get("description") if isinstance(body.get("description"), str) else None,
            owner_key=actor.key,
        )
        db.add(container)
        db.flush()
        audit = append_audit(
            db,
            actor_key=actor.key,
            action=f"{kind}.create",
            target=kind,
            business_id=container.id,
            request_id=_request_id(request),
            after=_container_out(db, container),
        )
        return {"item": _container_out(db, container), "audit_event_id": audit.id}, 201

    return _mutation(db, actor=actor, operation=f"{kind}.create", key=key, payload=body, handler=handler)


def _create_version(
    db: Session,
    *,
    kind: str,
    container_id: str,
    body: dict[str, Any],
    actor: Actor,
    request: Request,
    key: str,
) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        container = _lookup(db, ResearchContainer, container_id)
        if container.container_type != kind:
            raise public_error(404, "NOT_FOUND", "Resource was not found")
        _require_owner(actor, container.owner_key)
        content = _required_object(body, "content")
        parent_id = body.get("parent_version_id")
        if parent_id:
            parent = _lookup(db, ResearchVersion, str(parent_id))
            if parent.container_id != container.id:
                raise public_error(422, "INVALID_PARENT_VERSION", "parent_version_id must belong to the same container")
        latest_no = db.scalar(select(func.max(ResearchVersion.version_no)).where(ResearchVersion.container_id == container.id)) or 0
        version = ResearchVersion(
            container_id=container.id,
            container_type=kind,
            version_no=int(latest_no) + 1,
            content_sha256=content_hash(content),
            parent_version_id=str(parent_id) if parent_id else None,
            note=body.get("note") if isinstance(body.get("note"), str) else None,
            created_by_key=actor.key,
            contract_name=str(content.get("contract_version") or content.get("contractVersion") or "reconstructed_content_v1"),
            content=content,
        )
        db.add(version)
        db.flush()
        audit = append_audit(
            db,
            actor_key=actor.key,
            action=f"{kind}.version.create",
            target=f"{kind}_version",
            business_id=version.id,
            request_id=_request_id(request),
            after=_version_out(version),
        )
        return {"item": _version_out(version), "audit_event_id": audit.id}, 201

    return _mutation(db, actor=actor, operation=f"{kind}.version.create:{container_id}", key=key, payload=body, handler=handler)


def _transition_version(
    db: Session,
    *,
    kind: str,
    version_id: str,
    action: str,
    body: dict[str, Any],
    actor: Actor,
    request: Request,
    key: str,
) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        version = _lookup(db, ResearchVersion, version_id)
        if version.container_type != kind:
            raise public_error(404, "NOT_FOUND", "Resource was not found")
        container = _lookup(db, ResearchContainer, version.container_id)
        _require_owner(actor, container.owner_key)
        reason = _required_string(body, "reason")
        before = _version_out(version)
        if action == "freeze":
            if version.status != "draft":
                raise public_error(409, "INVALID_LIFECYCLE_TRANSITION", "Only draft versions can be frozen")
            version.status = "frozen"
            version.frozen_by_key = actor.key
            version.frozen_at = utcnow()
            version.freeze_reason = reason
        else:
            if version.status not in {"draft", "frozen"}:
                raise public_error(409, "INVALID_LIFECYCLE_TRANSITION", "Only draft or frozen versions can be deprecated")
            version.status = "deprecated"
            version.deprecated_by_key = actor.key
            version.deprecated_at = utcnow()
            version.deprecate_reason = reason
        audit = append_audit(
            db,
            actor_key=actor.key,
            action=f"{kind}.version.{action}",
            target=f"{kind}_version",
            business_id=version.id,
            request_id=_request_id(request),
            reason=reason,
            before=before,
            after=_version_out(version),
        )
        return {"item": _version_out(version), "audit_event_id": audit.id}, 200

    return _mutation(db, actor=actor, operation=f"{kind}.version.{action}:{version_id}", key=key, payload=body, handler=handler)


def _experiment_out(value: Experiment) -> dict[str, Any]:
    return {
        "id": value.id,
        "owner_key": value.owner_key,
        "protocol": value.protocol,
        "protocol_sha256": value.protocol_sha256,
        "dataset_version_id": value.dataset_version_id,
        "strategy_version_id": value.strategy_version_id,
        "model_version_id": value.model_version_id,
        "risk_rule_version_id": value.risk_rule_version_id,
        "status": value.status,
        "frozen_at": value.frozen_at,
        "created_at": value.created_at,
    }


def _run_out(value: Run) -> dict[str, Any]:
    return {
        "id": value.id,
        "experiment_id": value.experiment_id,
        "task_id": value.task_id,
        "source_run_id": value.source_run_id,
        "fingerprint": value.fingerprint,
        "run_manifest": value.run_manifest,
        "run_manifest_sha256": value.run_manifest_sha256,
        "status": value.status,
        "result_completeness": value.result_completeness,
        "business_result_sha256": value.business_result_sha256,
        "error_code": value.error_code,
        "error_message": value.error_message,
        "created_at": value.created_at,
        "started_at": value.started_at,
        "completed_at": value.completed_at,
    }


def _artifact_out(value: Artifact) -> dict[str, Any]:
    return {
        "id": value.id,
        "run_id": value.run_id,
        "artifact_type": value.artifact_type,
        "format": value.format,
        "size_bytes": value.size_bytes,
        "sha256": value.sha256,
        "logical_content_sha256": value.logical_content_sha256,
        "row_count": value.row_count,
        "completeness": value.completeness,
        "storage_kind": value.storage_kind,
        "schema_version": value.schema_version,
        "generated_by_task_id": value.generated_by_task_id,
        "created_at": value.created_at,
    }


def _validation_out(value: ValidationRun) -> dict[str, Any]:
    return {
        "id": value.id,
        "experiment_id": value.experiment_id,
        "task_id": value.task_id,
        "protocol_sha256": value.protocol_sha256,
        "window_index": value.window_index,
        "seed": value.seed,
        "scenario_name": value.scenario_name,
        "status": value.status,
        "result_completeness": value.result_completeness,
        "metrics": value.metrics,
        "business_result_sha256": value.business_result_sha256,
        "error_code": value.error_code,
        "error_message": value.error_message,
        "created_at": value.created_at,
        "started_at": value.started_at,
        "completed_at": value.completed_at,
    }


def _report_out(value: Report) -> dict[str, Any]:
    return {
        "id": value.id,
        "owner_key": value.owner_key,
        "experiment_id": value.experiment_id,
        "title": value.title,
        "contract_version": value.contract_version,
        "content_sha256": value.content_sha256,
        "status": value.status,
        "submitted_at": value.submitted_at,
        "approved_by_key": value.approved_by_key,
        "approved_at": value.approved_at,
        "deprecated_by_key": value.deprecated_by_key,
        "deprecated_at": value.deprecated_at,
        "created_at": value.created_at,
        "updated_at": value.updated_at,
    }


def _canonical_report_content(content: dict[str, Any]) -> dict[str, Any]:
    converted = dict(content)
    aliases = {
        "contractVersion": "contract_version",
        "dataCutoff": "data_cutoff",
        "applicableUniverse": "applicable_universe",
        "predictionHorizonDays": "prediction_horizon_days",
    }
    for source, target in aliases.items():
        if source in converted and target not in converted:
            converted[target] = converted.pop(source)
    blocks = converted.get("blocks")
    if isinstance(blocks, list):
        normalized: list[Any] = []
        for block in blocks:
            if not isinstance(block, dict):
                raise public_error(422, "VALIDATION_ERROR", "report blocks must be objects")
            item = dict(block)
            if "bodyMd" in item and "body_md" not in item:
                item["body_md"] = item.pop("bodyMd")
            if "modelVersionSha256" in item and "model_version_sha256" not in item:
                item["model_version_sha256"] = item.pop("modelVersionSha256")
            normalized.append(item)
        converted["blocks"] = normalized
    for field in ("contract_version", "title", "data_cutoff", "applicable_universe", "prediction_horizon_days", "blocks"):
        if field not in converted:
            raise public_error(422, "VALIDATION_ERROR", f"report content requires {field}")
    return converted


def _paper_account_out(account: PaperAccount) -> dict[str, Any]:
    return {
        "id": account.id,
        "name": account.name,
        "status": account.status,
        "initial_capital": _decimal_text(account.initial_capital),
        "cash": _decimal_text(account.cash),
        "stop_reason": account.stop_reason,
        "stopped_at": account.stopped_at,
        "created_at": account.created_at,
        "updated_at": account.updated_at,
    }


def _decimal_text(value: Decimal | object) -> str:
    """Return fixed-point financial JSON, preserving decimal precision."""

    return format(Decimal(str(value)), "f")


def _paper_order_out(order: PaperOrder) -> dict[str, Any]:
    price = Decimal(str(order.price)) if order.price is not None else None
    return {
        "id": order.id,
        "account_id": order.account_id,
        "client_order_id": order.client_order_id,
        "broker_order_id": order.broker_order_id,
        "symbol": order.symbol,
        "exchange": order.exchange,
        "side": order.side,
        "direction": order.side,
        "order_type": order.order_type,
        "quantity": _decimal_text(order.quantity),
        "price": _decimal_text(price) if price is not None else None,
        "filled_quantity": _decimal_text(order.filled_quantity),
        "avg_fill_price": _decimal_text(order.avg_fill_price) if order.avg_fill_price is not None else None,
        "status": order.status,
        "error_code": order.error_code,
        "error_message": order.error_message,
        "submitted_at": order.submitted_at,
        "completed_at": order.completed_at,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


def _select_paper_account(db: Session, account_id: str | None) -> PaperAccount:
    if account_id:
        return _lookup(db, PaperAccount, account_id, "PAPER_ACCOUNT_NOT_FOUND")
    accounts = db.scalars(select(PaperAccount).order_by(PaperAccount.created_at, PaperAccount.id)).all()
    if not accounts:
        account = PaperAccount(
            name="default-paper-account",
            status="active",
            initial_capital=Decimal("1000000"),
            cash=Decimal("1000000"),
        )
        db.add(account)
        db.flush()
        return account
    if len(accounts) > 1:
        raise public_error(409, "AMBIGUOUS_PAPER_ACCOUNT", "account_id is required when multiple paper accounts exist")
    return accounts[0]


def _paper_snapshot(db: Session, account: PaperAccount) -> dict[str, Any]:
    positions = paper_positions(db, account.id)
    ui_positions: list[dict[str, Any]] = []
    market_value = Decimal("0")
    for position in positions:
        quantity = Decimal(str(position["quantity"]))
        average = Decimal(str(position["avg_price"]))
        value = quantity * average
        market_value += value
        ui_positions.append(
            {
                **position,
                "name": position["symbol"],
                "quantity": _decimal_text(quantity),
                "market_value": _decimal_text(value),
                "pnl": "0",
                "pnl_pct": "0",
            }
        )
    orders = db.scalars(
        select(PaperOrder).where(PaperOrder.account_id == account.id).order_by(desc(PaperOrder.created_at), desc(PaperOrder.id)).limit(50)
    ).all()
    open_count = sum(order.status not in {"blocked", "rejected", "filled", "cancelled"} for order in orders)
    total = Decimal(str(account.cash)) + market_value
    account_out = _paper_account_out(account)
    account_out.update(
        {
            "total": _decimal_text(total),
            "available": _decimal_text(account.cash),
            "market_value": _decimal_text(market_value),
            "day_pnl": "0",
            "day_pnl_pct": "0",
        }
    )
    order_out = [_paper_order_out(order) for order in orders]
    return {
        "status": "running" if account.status == "active" else "stopped",
        "account": account_out,
        "positions": ui_positions,
        "orders": order_out,
        "recent_orders": order_out,
        "open_order_count": open_count,
        "updated_at": account.updated_at,
    }


def _reconciliation_out(value: ReconciliationRun) -> dict[str, Any]:
    return {
        "id": value.id,
        "account_id": value.account_id,
        "status": value.status,
        "result_status": value.result_status,
        "execution_status": value.status,
        "discrepancies": value.discrepancies,
        "started_at": value.started_at,
        "completed_at": value.completed_at,
        "created_at": value.created_at,
        "checked_targets_count": value.checked_targets_count,
        "differences_count": value.differences_count,
        "summary": "Differences require explicit review" if value.discrepancies else "No discrepancies recorded",
    }


# ---------------------------------------------------------------------------
# Infrastructure, auth, health
# ---------------------------------------------------------------------------


@router.post("/auth/dev-session", operation_id="dev_session_api_v1_auth_dev_session_post")
def dev_session(body: DevSessionRequest) -> DevSessionResponse:
    token, expires_at, scopes = issue_dev_token(body.login_name, body.role)
    return DevSessionResponse(
        token=token,
        expires_at=datetime.fromtimestamp(expires_at, timezone.utc),
        role=body.role,
        scopes=list(scopes),
    )


@router.get("/auth/me", operation_id="me_api_v1_auth_me_get")
def me(actor: Actor = Depends(get_current_actor)) -> AuthMeResponse:
    return AuthMeResponse(login_name=actor.login_name, role=actor.role, scopes=list(actor.scopes))


@router.get("/health", operation_id="health_api_v1_health_get")
def health() -> dict[str, Any]:
    return {"status": "ok", "mode": "local-reconstructed", "external_trading": "disabled"}


@router.get("/health/live", operation_id="live_api_v1_health_live_get")
def health_live() -> dict[str, Any]:
    return {"status": "ok"}


@router.get("/health/ready", operation_id="ready_api_v1_health_ready_get")
def health_ready(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Perform a request-time liveness probe without checking on import."""

    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise public_error(503, "NOT_READY", "Database readiness check failed") from None
    return {"status": "ready", "database": "reachable"}


@router.get("/health/system", operation_id="system_health_api_v1_health_system_get")
def health_system(db: Session = Depends(get_db)) -> dict[str,Any]:
    """Report observed local queue state without creating a worker/fixture row."""

    try:
        counts = task_counts(db)
        workers = online_workers(db, heartbeat_seconds=settings.WORKER_HEARTBEAT_SECONDS)
        database = "reachable"
        status = "ok"
    except SQLAlchemyError:
        counts = {"queued": 0, "claimed": 0, "running": 0}
        workers = []
        database = "unavailable"
        status = "degraded"
    return {
        "status": status,
        "database": database,
        "migration": {"current": "0007_recovered_worker_queue", "head": "0007_recovered_worker_queue"},
        "workers": [
            {"worker_id": worker.worker_id, "last_seen_at": worker.last_seen_at, "current_task_id": worker.current_task_id}
            for worker in workers
        ],
        "tasks": counts,
        "storage": {
            "artifact_root": {"path": "local-managed", "writable": False, "size_bytes": 0},
            "data_root": {"path": "local-managed", "writable": False, "size_bytes": 0},
        },
        "timestamp": utcnow(),
    }


@router.get("/backup-metadata", operation_id="backup_metadata_api_v1_backup_metadata_get")
def backup_metadata(actor: Actor = Depends(require_scope("audit:read"))) -> dict[str, Any]:
    return {"status": "not_configured", "reason": "Recovery contains no external backup integration"}


# ---------------------------------------------------------------------------
# B2 data lineage, deterministic local tasks and PIT-safe empty queries
# ---------------------------------------------------------------------------


@router.get("/data-sources", operation_id="list_data_sources_api_v1_data_sources_get")
def list_data_sources(
    page: int = Query(1), page_size: int = Query(100), name: str | None = None, adapter: str | None = None, status: str | None = None,
    db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read")),
) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(DataSource).order_by(DataSource.name, DataSource.id)).all()
    if name:
        values = [value for value in values if name.lower() in value.name.lower()]
    if adapter:
        values = [value for value in values if value.adapter == adapter]
    if status:
        values = [value for value in values if value.status == status]
    return page_response(values, page, page_size, _data_source_out)


@router.get("/datasets", operation_id="list_datasets_api_v1_datasets_get")
def list_datasets(
    page: int = Query(1), page_size: int = Query(20), name: str | None = None, market: str | None = None, frequency: str | None = None,
    status: str | None = None, dataset_status: str | None = None, data_source_id: str | None = None,
    db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read")),
) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(Dataset).order_by(Dataset.created_at, Dataset.id)).all()
    if name:
        values = [value for value in values if name.lower() in value.name.lower()]
    if market:
        values = [value for value in values if value.market == market]
    if frequency:
        values = [value for value in values if value.frequency == frequency]
    if status or dataset_status:
        target = status or dataset_status
        values = [value for value in values if value.status == target]
    if data_source_id:
        values = [value for value in values if db.scalar(select(DatasetVersion.id).where(DatasetVersion.dataset_id == value.id, DatasetVersion.data_source_id == data_source_id))]
    return page_response(values, page, page_size, lambda value: _dataset_out(db, value))


@router.post("/datasets", operation_id="create_dataset_api_v1_datasets_post")
def create_dataset(
    request: Request, body: DatasetCreate = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write")),
) -> JSONResponse:
    payload = body.model_dump(mode="json")

    def handler() -> tuple[dict[str, Any], int]:
        name = body.name.strip()
        market = body.market.strip()
        slug = str(body.slug or _slug(name))
        if db.scalar(select(Dataset).where(Dataset.slug == slug)):
            raise public_error(409, "DUPLICATE_SLUG", "A dataset with this slug already exists")
        value = Dataset(
            slug=slug,
            name=name,
            market=market,
            frequency=body.frequency,
            schema_version=body.schema_version,
            license=body.license,
        )
        db.add(value)
        db.flush()
        audit = append_audit(db, actor_key=actor.key, action="dataset.create", target="dataset", business_id=value.id, request_id=_request_id(request), after=_dataset_out(db, value))
        return _dataset_out(db, value) | {"audit_event_id": audit.id}, 201

    return _mutation(db, actor=actor, operation="dataset.create", key=idempotency_key, payload=payload, handler=handler)


@router.get("/datasets/{dataset_id}", operation_id="get_dataset_api_v1_datasets__dataset_id__get")
def get_dataset(dataset_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _dataset_out(db, _lookup(db, Dataset, dataset_id, "DATASET_NOT_FOUND"), detail=True)


@router.get("/datasets/{dataset_id}/versions", operation_id="list_dataset_versions_api_v1_datasets__dataset_id__versions_get")
def list_dataset_versions(
    dataset_id: UUIDPath, page: int = Query(1), page_size: int = Query(20), status: str | None = None, quality_status: str | None = None, data_source_id: str | None = None,
    db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read")),
) -> dict[str, Any]:
    _page_args(page, page_size)
    _lookup(db, Dataset, dataset_id, "DATASET_NOT_FOUND")
    values = db.scalars(select(DatasetVersion).where(DatasetVersion.dataset_id == dataset_id).order_by(desc(DatasetVersion.version_no))).all()
    if status:
        values = [value for value in values if value.status == status]
    if quality_status:
        values = [value for value in values if value.quality_status == quality_status]
    if data_source_id:
        values = [value for value in values if value.data_source_id == data_source_id]
    return page_response(values, page, page_size, lambda value: _dataset_version_out(db, value))


@router.post("/datasets/{dataset_id}/versions", operation_id="create_version_api_v1_datasets__dataset_id__versions_post")
def create_dataset_version(
    dataset_id: UUIDPath, request: Request, body: DatasetVersionCreate = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write")),
) -> JSONResponse:
    payload = body.model_dump(mode="json")

    def handler() -> tuple[dict[str, Any], int]:
        dataset = _lookup(db, Dataset, dataset_id, "DATASET_NOT_FOUND")
        if db.get_bind().dialect.name == "postgresql":
            # Serialize version number allocation on the parent dataset row.
            db.execute(select(Dataset.id).where(Dataset.id == dataset.id).with_for_update()).scalar_one()
        source_id = str(body.data_source_id)
        source = _lookup(db, DataSource, source_id, "DATA_SOURCE_NOT_FOUND")
        if source.status != "active":
            raise public_error(409, "DATA_SOURCE_UNAVAILABLE", "Data source is not active")
        if source.adapter != "deterministic_fixture":
            raise public_error(422, "UNSUPPORTED_DATA_SOURCE", "Only deterministic fixture data sources can be materialized")
        start = body.time_start.isoformat()
        end = body.time_end.isoformat()
        if start > end:
            raise public_error(422, "INVALID_TIME_RANGE", "time_start must not be after time_end")
        symbols = list(body.symbols)
        row_count = ((body.time_end - body.time_start).days + 1) * len(symbols)
        if row_count > 1_000_000:
            raise public_error(422, "FIXTURE_ROW_LIMIT", "Deterministic fixture row limit exceeded")
        parent = str(body.parent_version_id) if body.parent_version_id else None
        parent_version: DatasetVersion | None = None
        if parent:
            parent_version = _lookup(db, DatasetVersion, str(parent), "DATASET_VERSION_NOT_FOUND")
            if parent_version.dataset_id != dataset.id:
                raise public_error(422, "INVALID_PARENT_VERSION", "parent_version_id must belong to the same dataset")
        version_no = int(db.scalar(select(func.max(DatasetVersion.version_no)).where(DatasetVersion.dataset_id == dataset.id)) or 0) + 1
        source_info = {"name": source.name, "revision": "deterministic-fixture-v1", "license_ref": source.license_ref}
        parent_version_id = parent_version.id if parent_version is not None else None
        logical = {
            "dataset_id": dataset.id,
            "time_start": start,
            "time_end": end,
            "symbols": sorted(symbols),
            "source_id": source.id,
            "parent_version_id": parent_version_id,
        }
        version = DatasetVersion(
            id=new_id(),
            dataset_id=dataset.id,
            version_no=version_no,
            status="draft",
            quality_status="pending",
            time_start=start,
            time_end=end,
            timezone=body.timezone,
            adjustment=body.adjustment,
            symbols=sorted(symbols),
            parent_version_id=parent_version_id,
            data_source_id=source.id,
            source=source_info,
            task_id=None,
            logical_content_sha256=content_hash(logical),
        )
        db.add(version)
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            raise public_error(409, "DATASET_VERSION_CONFLICT", "A concurrent version allocation conflicted; retry with a new idempotency key") from None
        task = Task(
            task_type="data_ingest",
            status="queued",
            owner_key=actor.key,
            priority=100,
            progress=0,
            payload={"dataset_version_id": version.id, "deterministic": True},
        )
        db.add(task)
        db.flush()
        version.task_id = task.id
        audit = append_audit(db, actor_key=actor.key, action="dataset.version.create", target="dataset_version", business_id=version.id, request_id=_request_id(request), after=_dataset_version_out(db, version, detail=True))
        return {"dataset_version_id": version.id, "task_id": task.id, "status": "queued", "status_url": f"/api/v1/tasks/{task.id}", "audit_event_id": audit.id}, 202

    return _mutation(db, actor=actor, operation=f"dataset.version.create:{dataset_id}", key=idempotency_key, payload=payload, handler=handler)


@router.get("/dataset-versions/{version_id}", operation_id="get_dataset_version_api_v1_dataset_versions__version_id__get")
def get_dataset_version(version_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _dataset_version_out(db, _lookup(db, DatasetVersion, version_id, "DATASET_VERSION_NOT_FOUND"), detail=True)


@router.post("/dataset-versions/{version_id}/aggregate", operation_id="aggregate_dataset_version_api_v1_dataset_versions__version_id__aggregate_post")
def aggregate_dataset_version(
    version_id: UUIDPath, body: AggregateRequest = Body(...), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read")),
) -> dict[str, Any]:
    version = _lookup(db, DatasetVersion, version_id, "DATASET_VERSION_NOT_FOUND")
    if version.status != "available" or version.quality_status != "passed" or not version.manifest:
        raise public_error(409, "DATASET_VERSION_NOT_QUERYABLE", "Dataset version is not available for querying")
    try:
        return _snapshot_store().aggregate_rows(
            dataset_id=version.dataset_id,
            version_id=version.id,
            manifest=version.manifest,
            start=body.start,
            end=body.end,
            metrics=list(body.metrics),
            symbols=list(body.symbols) if body.symbols else None,
            max_points=body.max_points,
        )
    except SnapshotStoreError:
        raise public_error(422, "INVALID_QUERY", "Dataset aggregate request is invalid") from None


@router.post("/dataset-versions/{version_id}/query", operation_id="query_dataset_version_api_v1_dataset_versions__version_id__query_post")
def query_dataset_version(
    version_id: UUIDPath, body: RowQueryRequest = Body(...), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read")),
) -> dict[str, Any]:
    version = _lookup(db, DatasetVersion, version_id, "DATASET_VERSION_NOT_FOUND")
    if version.status != "available" or version.quality_status != "passed" or not version.manifest:
        raise public_error(409, "DATASET_VERSION_NOT_QUERYABLE", "Dataset version is not available for querying")
    try:
        return _snapshot_store().query_rows(
            dataset_id=version.dataset_id,
            version_id=version.id,
            manifest=version.manifest,
            start=body.start,
            end=body.end,
            columns=list(body.columns),
            symbols=list(body.symbols) if body.symbols else None,
            cursor=body.cursor,
            limit=body.limit,
        )
    except (TypeError, ValueError, SnapshotStoreError):
        raise public_error(422, "INVALID_QUERY", "Dataset query request is invalid") from None


@router.get("/dataset-versions/{version_id}/lineage", operation_id="get_lineage_api_v1_dataset_versions__version_id__lineage_get")
def get_lineage(version_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _lineage_out(db, _lookup(db, DatasetVersion, version_id, "DATASET_VERSION_NOT_FOUND"))


@router.get("/dataset-versions/{version_id}/quality-runs", operation_id="list_quality_runs_api_v1_dataset_versions__version_id__quality_runs_get")
def list_quality_runs(
    version_id: UUIDPath, page: int = Query(1), page_size: int = Query(20), status: str | None = None,
    db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read")),
) -> dict[str, Any]:
    _page_args(page, page_size)
    _lookup(db, DatasetVersion, version_id, "DATASET_VERSION_NOT_FOUND")
    values = db.scalars(select(DataQualityRun).where(DataQualityRun.version_id == version_id).order_by(desc(DataQualityRun.created_at), desc(DataQualityRun.id))).all()
    if status:
        values = [value for value in values if value.status == status]
    return page_response(values, page, page_size, _quality_run_out)


@router.post("/dataset-versions/{version_id}/quality-runs", operation_id="create_quality_run_api_v1_dataset_versions__version_id__quality_runs_post")
def create_quality_run(
    version_id: UUIDPath, request: Request, body: dict[str, Any] | None = Body(None), idempotency_key: str = Header(..., alias="Idempotency-Key"),
    db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write")),
) -> JSONResponse:
    payload = body or {}

    def handler() -> tuple[dict[str, Any], int]:
        version = _lookup(db, DatasetVersion, version_id, "DATASET_VERSION_NOT_FOUND")
        task = Task(task_type="data_quality", status="queued", owner_key=actor.key, priority=100, progress=0, payload={"dataset_version_id": version.id, "deterministic": True})
        db.add(task)
        db.flush()
        run = DataQualityRun(
            version_id=version.id,
            task_id=task.id,
            rule_set_version=str(payload.get("rule_set_version") or "local-quality-v1"),
            status="queued",
            results=[],
        )
        db.add(run)
        db.flush()
        task.payload = {"dataset_version_id": version.id, "quality_run_id": run.id, "deterministic": True}
        audit = append_audit(db, actor_key=actor.key, action="dataset.quality.run", target="dataset_version", business_id=version.id, request_id=_request_id(request), after=_quality_run_out(run))
        return {"quality_run_id": run.id, "task_id": task.id, "status": "queued", "status_url": f"/api/v1/tasks/{task.id}", "audit_event_id": audit.id}, 202

    return _mutation(db, actor=actor, operation=f"dataset.quality.create:{version_id}", key=idempotency_key, payload=payload, handler=handler)


# ---------------------------------------------------------------------------
# B3 strategy/model/risk containers and immutable content-hash versions
# ---------------------------------------------------------------------------


def _list_containers(kind: str, page: int, page_size: int, name: str | None, owner_key: str | None, latest_status: str | None, db: Session) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(ResearchContainer).where(ResearchContainer.container_type == kind).order_by(ResearchContainer.created_at, ResearchContainer.id)).all()
    if name:
        values = [value for value in values if name.lower() in value.name.lower()]
    if owner_key:
        values = [value for value in values if value.owner_key == owner_key]
    if latest_status:
        values = [value for value in values if (_container_out(db, value)["latest_version_status"] == latest_status)]
    return page_response(values, page, page_size, lambda value: _container_out(db, value))


def _list_versions(kind: str, container_id: str, page: int, page_size: int, status: str | None, db: Session) -> dict[str, Any]:
    _page_args(page, page_size)
    container = _lookup(db, ResearchContainer, container_id)
    if container.container_type != kind:
        raise public_error(404, "NOT_FOUND", "Resource was not found")
    values = db.scalars(select(ResearchVersion).where(ResearchVersion.container_id == container_id).order_by(desc(ResearchVersion.version_no))).all()
    if status:
        values = [value for value in values if value.status == status]
    return page_response(values, page, page_size, _version_out)


@router.get("/strategies", operation_id="list_strategies_api_v1_strategies_get")
def list_strategies(page: int = Query(1), page_size: int = Query(20), name: str | None = None, owner_key: str | None = None, latest_status: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _list_containers("strategy", page, page_size, name, owner_key, latest_status, db)


@router.post("/strategies", operation_id="create_strategy_api_v1_strategies_post")
def create_strategy(request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _create_container(db, kind="strategy", body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/strategies/{strategy_id}", operation_id="get_strategy_api_v1_strategies__strategy_id__get")
def get_strategy(strategy_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    value = _lookup(db, ResearchContainer, strategy_id)
    if value.container_type != "strategy":
        raise public_error(404, "NOT_FOUND", "Resource was not found")
    return _container_out(db, value)


@router.get("/strategies/{strategy_id}/versions", operation_id="list_strategy_versions_api_v1_strategies__strategy_id__versions_get")
def list_strategy_versions(strategy_id: UUIDPath, page: int = Query(1), page_size: int = Query(20), status: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _list_versions("strategy", strategy_id, page, page_size, status, db)


@router.post("/strategies/{strategy_id}/versions", operation_id="create_strategy_version_api_v1_strategies__strategy_id__versions_post")
def create_strategy_version(strategy_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _create_version(db, kind="strategy", container_id=strategy_id, body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/strategy-versions/{version_id}", operation_id="get_strategy_version_api_v1_strategy_versions__version_id__get")
def get_strategy_version(version_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    value = _lookup(db, ResearchVersion, version_id)
    if value.container_type != "strategy":
        raise public_error(404, "NOT_FOUND", "Resource was not found")
    return _version_out(value)


@router.post("/strategy-versions/{version_id}/freeze", operation_id="freeze_strategy_version_api_v1_strategy_versions__version_id__freeze_post")
def freeze_strategy_version(version_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _transition_version(db, kind="strategy", version_id=version_id, action="freeze", body=body, actor=actor, request=request, key=idempotency_key)


@router.post("/strategy-versions/{version_id}/deprecate", operation_id="deprecate_strategy_version_api_v1_strategy_versions__version_id__deprecate_post")
def deprecate_strategy_version(version_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _transition_version(db, kind="strategy", version_id=version_id, action="deprecate", body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/models", operation_id="list_models_api_v1_models_get")
def list_models(page: int = Query(1), page_size: int = Query(20), name: str | None = None, owner_key: str | None = None, latest_status: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _list_containers("model", page, page_size, name, owner_key, latest_status, db)


@router.post("/models", operation_id="create_model_api_v1_models_post")
def create_model(request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _create_container(db, kind="model", body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/models/{model_id}", operation_id="get_model_api_v1_models__model_id__get")
def get_model(model_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    value = _lookup(db, ResearchContainer, model_id)
    if value.container_type != "model":
        raise public_error(404, "NOT_FOUND", "Resource was not found")
    return _container_out(db, value)


@router.get("/models/{model_id}/versions", operation_id="list_model_versions_api_v1_models__model_id__versions_get")
def list_model_versions(model_id: UUIDPath, page: int = Query(1), page_size: int = Query(20), status: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _list_versions("model", model_id, page, page_size, status, db)


@router.post("/models/{model_id}/versions", operation_id="create_model_version_api_v1_models__model_id__versions_post")
def create_model_version(model_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _create_version(db, kind="model", container_id=model_id, body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/model-versions/{version_id}", operation_id="get_model_version_api_v1_model_versions__version_id__get")
def get_model_version(version_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    value = _lookup(db, ResearchVersion, version_id)
    if value.container_type != "model":
        raise public_error(404, "NOT_FOUND", "Resource was not found")
    return _version_out(value)


@router.post("/model-versions/{version_id}/freeze", operation_id="freeze_model_version_api_v1_model_versions__version_id__freeze_post")
def freeze_model_version(version_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _transition_version(db, kind="model", version_id=version_id, action="freeze", body=body, actor=actor, request=request, key=idempotency_key)


@router.post("/model-versions/{version_id}/deprecate", operation_id="deprecate_model_version_api_v1_model_versions__version_id__deprecate_post")
def deprecate_model_version(version_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _transition_version(db, kind="model", version_id=version_id, action="deprecate", body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/risk-rule-sets", operation_id="list_risk_rule_sets_api_v1_risk_rule_sets_get")
def list_risk_rule_sets(page: int = Query(1), page_size: int = Query(20), name: str | None = None, owner_key: str | None = None, latest_status: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _list_containers("risk_rule_set", page, page_size, name, owner_key, latest_status, db)


@router.post("/risk-rule-sets", operation_id="create_risk_rule_set_api_v1_risk_rule_sets_post")
def create_risk_rule_set(request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _create_container(db, kind="risk_rule_set", body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/risk-rule-sets/{risk_rule_set_id}", operation_id="get_risk_rule_set_api_v1_risk_rule_sets__risk_rule_set_id__get")
def get_risk_rule_set(risk_rule_set_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    value = _lookup(db, ResearchContainer, risk_rule_set_id)
    if value.container_type != "risk_rule_set":
        raise public_error(404, "NOT_FOUND", "Resource was not found")
    return _container_out(db, value)


@router.get("/risk-rule-sets/{risk_rule_set_id}/versions", operation_id="list_risk_rule_versions_api_v1_risk_rule_sets__risk_rule_set_id__versions_get")
def list_risk_rule_versions(risk_rule_set_id: UUIDPath, page: int = Query(1), page_size: int = Query(20), status: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _list_versions("risk_rule_set", risk_rule_set_id, page, page_size, status, db)


@router.post("/risk-rule-sets/{risk_rule_set_id}/versions", operation_id="create_risk_rule_version_api_v1_risk_rule_sets__risk_rule_set_id__versions_post")
def create_risk_rule_version(risk_rule_set_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _create_version(db, kind="risk_rule_set", container_id=risk_rule_set_id, body=body, actor=actor, request=request, key=idempotency_key)


@router.get("/risk-rule-versions/{version_id}", operation_id="get_risk_rule_version_api_v1_risk_rule_versions__version_id__get")
def get_risk_rule_version(version_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    value = _lookup(db, ResearchVersion, version_id)
    if value.container_type != "risk_rule_set":
        raise public_error(404, "NOT_FOUND", "Resource was not found")
    return _version_out(value)


@router.post("/risk-rule-versions/{version_id}/freeze", operation_id="freeze_risk_rule_version_api_v1_risk_rule_versions__version_id__freeze_post")
def freeze_risk_rule_version(version_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _transition_version(db, kind="risk_rule_set", version_id=version_id, action="freeze", body=body, actor=actor, request=request, key=idempotency_key)


@router.post("/risk-rule-versions/{version_id}/deprecate", operation_id="deprecate_risk_rule_version_api_v1_risk_rule_versions__version_id__deprecate_post")
def deprecate_risk_rule_version(version_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _transition_version(db, kind="risk_rule_set", version_id=version_id, action="deprecate", body=body, actor=actor, request=request, key=idempotency_key)


# ---------------------------------------------------------------------------
# B4 experiments, deterministic runs/tasks/artifacts
# ---------------------------------------------------------------------------


def _protocol_value(protocol: dict[str, Any], snake: str) -> Any:
    parts = snake.split("_")
    camel = parts[0] + "".join(word.capitalize() for word in parts[1:])
    return protocol.get(snake, protocol.get(camel))


def _validate_experiment_references(db: Session, protocol: dict[str, Any]) -> tuple[DatasetVersion, ResearchVersion, ResearchVersion, ResearchVersion]:
    dataset_id = _protocol_value(protocol, "dataset_version_id")
    strategy_id = _protocol_value(protocol, "strategy_version_id")
    model_id = _protocol_value(protocol, "model_version_id")
    risk_id = _protocol_value(protocol, "risk_rule_version_id")
    if not all(isinstance(value, str) and value for value in (dataset_id, strategy_id, model_id, risk_id)):
        raise public_error(422, "VALIDATION_ERROR", "Experiment protocol must reference all frozen research inputs")
    dataset = _lookup(db, DatasetVersion, dataset_id, "DATASET_VERSION_NOT_FOUND")
    eligible, _, _ = _quality_gate(dataset)
    if not eligible:
        raise public_error(409, "DATASET_VERSION_NOT_ELIGIBLE", "Dataset version is not eligible for a new experiment")
    expected = ((strategy_id, "strategy"), (model_id, "model"), (risk_id, "risk_rule_set"))
    versions: list[ResearchVersion] = []
    for version_id, kind in expected:
        version = _lookup(db, ResearchVersion, version_id, "RESEARCH_VERSION_NOT_FOUND")
        if version.container_type != kind or version.status != "frozen":
            raise public_error(409, "RESEARCH_VERSION_NOT_ELIGIBLE", "Experiment references must be frozen versions")
        versions.append(version)
    return dataset, versions[0], versions[1], versions[2]


@router.get("/experiments", operation_id="list_experiments_api_v1_experiments_get")
def list_experiments(page: int = Query(1), page_size: int = Query(20), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(Experiment).order_by(Experiment.created_at, Experiment.id)).all()
    return page_response(values, page, page_size, _experiment_out)


@router.post("/experiments", operation_id="create_experiment_api_v1_experiments_post")
def create_experiment(request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        dataset, strategy, model, risk = _validate_experiment_references(db, body)
        value = Experiment(
            owner_key=actor.key,
            protocol=body,
            protocol_sha256=content_hash(body),
            dataset_version_id=dataset.id,
            strategy_version_id=strategy.id,
            model_version_id=model.id,
            risk_rule_version_id=risk.id,
            status="frozen",
            frozen_at=utcnow(),
        )
        db.add(value)
        db.flush()
        audit = append_audit(db, actor_key=actor.key, action="experiment.create", target="experiment", business_id=value.id, request_id=_request_id(request), after=_experiment_out(value))
        return {"item": _experiment_out(value), "audit_event_id": audit.id}, 201

    return _mutation(db, actor=actor, operation="experiment.create", key=idempotency_key, payload=body, handler=handler)


@router.get("/experiments/{experiment_id}", operation_id="get_experiment_api_v1_experiments__experiment_id__get")
def get_experiment(experiment_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _experiment_out(_lookup(db, Experiment, experiment_id, "EXPERIMENT_NOT_FOUND"))


def _run_manifest(experiment: Experiment, dataset: DatasetVersion, strategy: ResearchVersion, model: ResearchVersion, risk: ResearchVersion) -> dict[str, Any]:
    return {
        "contract_version": "run_manifest_v1",
        "protocol_sha256": experiment.protocol_sha256,
        "backtest_bundle_manifest_sha256": dataset.manifest_sha256 or content_hash({"empty": True}),
        "dataset_version_id": dataset.id,
        "dataset_version_sha256": dataset.logical_content_sha256 or "",
        "strategy_version_id": strategy.id,
        "strategy_version_sha256": strategy.content_sha256,
        "model_version_id": model.id,
        "model_version_sha256": model.content_sha256,
        "risk_rule_version_id": risk.id,
        "risk_rule_version_sha256": risk.content_sha256,
        "engine_contract": "local-deterministic-no-backtest",
        "market_rule_version": "reconstructed",
        "code_version": "reconstructed",
        "dependency_lock_sha256": content_hash({"dependencies": "local"}),
        "runtime": {"python": "local", "platform": "local"},
        "seed": int(_protocol_value(experiment.protocol, "seed") or 0),
    }


def _create_run_for_experiment(db: Session, experiment: Experiment, body: dict[str, Any], actor: Actor, request: Request) -> tuple[dict[str, Any], int]:
    _require_owner(actor, experiment.owner_key)
    dataset = _lookup(db, DatasetVersion, experiment.dataset_version_id)
    strategy = _lookup(db, ResearchVersion, experiment.strategy_version_id)
    model = _lookup(db, ResearchVersion, experiment.model_version_id)
    risk = _lookup(db, ResearchVersion, experiment.risk_rule_version_id)
    manifest = _run_manifest(experiment, dataset, strategy, model, risk)
    fingerprint = content_hash({"protocol": experiment.protocol_sha256, "manifest": manifest})
    duplicate = db.scalar(select(Run).where(Run.experiment_id == experiment.id, Run.fingerprint == fingerprint).order_by(Run.created_at).limit(1))
    duplicate_mode = str(body.get("on_duplicate") or "reuse")
    if duplicate_mode not in {"reuse", "create_rerun"}:
        raise public_error(422, "VALIDATION_ERROR", "on_duplicate must be reuse or create_rerun")
    if duplicate and duplicate_mode == "reuse":
        return {"outcome": "duplicate", "item": _run_out(duplicate), "task": _task_out(_lookup(db, Task, duplicate.task_id)), "audit_event_id": None}, 200
    task = Task(task_type="backtest", status="queued", owner_key=actor.key, priority=100, payload={"deterministic": True}, progress=0)
    db.add(task)
    db.flush()
    run = Run(
        experiment_id=experiment.id,
        task_id=task.id,
        source_run_id=duplicate.id if duplicate and duplicate_mode == "create_rerun" else None,
        fingerprint=fingerprint,
        run_manifest=manifest,
        run_manifest_sha256=content_hash(manifest),
        status="queued",
        result_completeness="pending",
        metrics={},
        business_result_sha256=None,
    )
    db.add(run)
    db.flush()
    task.run_id = run.id
    task.payload = {"deterministic": True, "run_id": run.id}
    audit = append_audit(db, actor_key=actor.key, action="run.create", target="run", business_id=run.id, request_id=_request_id(request), after=_run_out(run))
    return {"outcome": "created", "item": _run_out(run), "task": _task_out(task), "audit_event_id": audit.id}, 202


@router.get("/experiments/{experiment_id}/runs", operation_id="list_runs_api_v1_experiments__experiment_id__runs_get")
def list_experiment_runs(experiment_id: UUIDPath, page: int = Query(1), page_size: int = Query(20), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    _lookup(db, Experiment, experiment_id, "EXPERIMENT_NOT_FOUND")
    values = db.scalars(select(Run).where(Run.experiment_id == experiment_id).order_by(desc(Run.created_at), desc(Run.id))).all()
    return page_response(values, page, page_size, _run_out)


@router.post("/experiments/{experiment_id}/runs", operation_id="create_run_api_v1_experiments__experiment_id__runs_post")
def create_run(experiment_id: UUIDPath, request: Request, body: dict[str, Any] | None = Body(None), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    payload = body or {}

    def handler() -> tuple[dict[str, Any], int]:
        return _create_run_for_experiment(db, _lookup(db, Experiment, experiment_id, "EXPERIMENT_NOT_FOUND"), payload, actor, request)

    return _mutation(db, actor=actor, operation=f"experiment.run.create:{experiment_id}", key=idempotency_key, payload=payload, handler=handler)


@router.get("/runs/{run_id}", operation_id="get_run_api_v1_runs__run_id__get")
def get_run(run_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _run_out(_lookup(db, Run, run_id, "RUN_NOT_FOUND"))


@router.get("/runs/{run_id}/metrics", operation_id="list_metrics_api_v1_runs__run_id__metrics_get")
def list_metrics(run_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> list[dict[str, Any]]:
    run = _lookup(db, Run, run_id, "RUN_NOT_FOUND")
    now = run.completed_at or run.created_at
    return [
        {"metric_name": name, "value": str(value), "unit": "ratio", "schema_version": "metric_summary_v1", "created_at": now}
        for name, value in sorted(run.metrics.items())
    ]


@router.get("/runs/{run_id}/artifacts", operation_id="list_artifacts_api_v1_runs__run_id__artifacts_get")
def list_run_artifacts(run_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> list[dict[str, Any]]:
    _lookup(db, Run, run_id, "RUN_NOT_FOUND")
    values = db.scalars(select(Artifact).where(Artifact.run_id == run_id).order_by(Artifact.created_at, Artifact.id)).all()
    return [_artifact_out(value) for value in values]


@router.post("/runs/{run_id}/cancel", operation_id="cancel_run_api_v1_runs__run_id__cancel_post")
def cancel_run(run_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        run = _lookup(db, Run, run_id, "RUN_NOT_FOUND")
        _require_owner(actor, _lookup(db, Experiment, run.experiment_id, "EXPERIMENT_NOT_FOUND").owner_key)
        reason = _required_string(body, "reason")
        before = _run_out(run)
        if run.status in {"success", "failed", "canceled"}:
            outcome = "canceled" if run.status == "canceled" else "duplicate"
        else:
            task = _lookup(db, Task, run.task_id, "TASK_NOT_FOUND")
            task.status = "cancel_requested"
            task.cancel_requested_at = utcnow()
            run.status = "cancel_requested"
            outcome = "cancel_requested"
        audit = append_audit(db, actor_key=actor.key, action="run.cancel", target="run", business_id=run.id, request_id=_request_id(request), reason=reason, before=before, after=_run_out(run))
        return {"outcome": outcome, "item": _run_out(run), "audit_event_id": audit.id}, 200

    return _mutation(db, actor=actor, operation=f"run.cancel:{run_id}", key=idempotency_key, payload=body, handler=handler)


@router.get("/tasks", operation_id="list_tasks_api_v1_tasks_get")
def list_tasks(page: int = Query(1), page_size: int = Query(20), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(Task).order_by(desc(Task.created_at), desc(Task.id))).all()
    return page_response(values, page, page_size, _task_out)


@router.post("/tasks", operation_id="create_task_api_v1_tasks_post")
def create_task(request: Request, body: TaskCreate, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    task = Task(task_type=body.task_type, status="queued", owner_key=actor.key, priority=body.priority, progress=0, payload=body.payload)
    db.add(task)
    db.flush()
    append_audit(db, actor_key=actor.key, action="task.create", target="task", business_id=task.id, request_id=_request_id(request), after=_task_out(task))
    return _commit_json(db, _task_out(task), 201)


@router.get("/tasks/{task_id}", operation_id="get_task_api_v1_tasks__task_id__get")
def get_task(task_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _task_out(_lookup(db, Task, task_id, "TASK_NOT_FOUND"))


@router.get("/tasks/{task_id}/artifacts", operation_id="list_task_artifacts_api_v1_tasks__task_id__artifacts_get")
def list_task_artifacts(task_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> list[dict[str, Any]]:
    _lookup(db, Task, task_id, "TASK_NOT_FOUND")
    values = db.scalars(select(Artifact).where(Artifact.task_id == task_id).order_by(Artifact.created_at, Artifact.id)).all()
    return [_artifact_out(value) for value in values]


@router.get("/artifacts/{artifact_id}", operation_id="get_artifact_api_v1_artifacts__artifact_id__get")
def get_artifact(artifact_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _artifact_out(_lookup(db, Artifact, artifact_id, "ARTIFACT_NOT_FOUND"))


@router.get("/artifacts/{artifact_id}/download", operation_id="download_artifact_api_v1_artifacts__artifact_id__download_get")
def download_artifact(artifact_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> Response:
    artifact = _lookup(db, Artifact, artifact_id, "ARTIFACT_NOT_FOUND")
    media_types = {
        "json": "application/json",
        "html": "text/html",
        "markdown": "text/markdown",
        "text": "text/plain",
        "parquet": "application/vnd.apache.parquet",
    }
    extensions = {"json": "json", "html": "html", "markdown": "md", "text": "txt", "parquet": "parquet"}
    artifact_format = artifact.format if artifact.format in media_types else "text"
    try:
        content = (
            base64.b64decode(artifact.content.encode("ascii"), validate=True)
            if artifact_format == "parquet"
            else artifact.content.encode("utf-8")
        )
    except (UnicodeEncodeError, ValueError):
        raise public_error(409, "ARTIFACT_INTEGRITY_FAILED", "Artifact integrity verification failed") from None
    # Worker-generated artifacts have a controlled local file as well as a DB
    # compatibility copy.  Verify both without returning the local path.
    if artifact.generated_by_task_id:
        try:
            expected = _snapshot_store().read_task_artifact(
                task_id=artifact.generated_by_task_id,
                artifact_type=artifact.artifact_type,
                extension=extensions[artifact_format],
            )
        except SnapshotStoreError:
            raise public_error(409, "ARTIFACT_INTEGRITY_FAILED", "Artifact integrity verification failed") from None
        if (
            artifact.id
            != _snapshot_store().artifact_id(
                task_id=artifact.generated_by_task_id,
                artifact_type=artifact.artifact_type,
            )
            or expected != content
            or artifact.sha256 != hashlib.sha256(content).hexdigest()
            or artifact.size_bytes != len(content)
        ):
            raise public_error(409, "ARTIFACT_INTEGRITY_FAILED", "Artifact integrity verification failed")
    filename = f"artifact-{artifact.id}.{extensions[artifact_format]}"
    return Response(
        content=content,
        media_type=media_types[artifact_format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/backtest-data-bundles", operation_id="list_backtest_data_bundles_api_v1_backtest_data_bundles_get")
def list_backtest_data_bundles(page: int = Query(1), page_size: int = Query(20), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    # Deterministic run manifests are the only reconstructed local bundle-like
    # facts.  There is no fabricated historical market-data bundle.
    return {"items": [], "page": {"has_more": False, "next_cursor": None}}


# ---------------------------------------------------------------------------
# B5 validation, risk events, immutable reports, audit
# ---------------------------------------------------------------------------


def _validate_validation_protocol(protocol: dict[str, Any]) -> tuple[list[dict[str, Any]], list[int], list[dict[str, Any]]]:
    windows = protocol.get("walk_forward_windows", protocol.get("walkForwardWindows"))
    seeds = protocol.get("seeds")
    scenarios = protocol.get("stress_scenarios", protocol.get("stressScenarios")) or [{"name": "base"}]
    if not isinstance(windows, list) or not windows or not isinstance(seeds, list) or not seeds or not isinstance(scenarios, list):
        raise public_error(422, "VALIDATION_PROTOCOL_INVALID", "walk_forward_windows, seeds and scenarios are required")
    previous_holdout_end: calendar_date | None = None
    for window in windows:
        if not isinstance(window, dict):
            raise public_error(422, "VALIDATION_PROTOCOL_INVALID", "walk-forward windows must be objects")
        phases: list[tuple[str, calendar_date, calendar_date]] = []
        for phase_name in ("train", "validation", "holdout"):
            phase = window.get(phase_name)
            if not isinstance(phase, dict):
                raise public_error(422, "VALIDATION_PROTOCOL_INVALID", f"{phase_name} window is required")
            start, end = phase.get("start_date", phase.get("startDate")), phase.get("end_date", phase.get("endDate"))
            if not isinstance(start, str) or not isinstance(end, str):
                raise public_error(422, "VALIDATION_PROTOCOL_INVALID", f"{phase_name} window has an invalid date range")
            try:
                start_date = calendar_date.fromisoformat(start)
                end_date = calendar_date.fromisoformat(end)
            except ValueError:
                raise public_error(422, "VALIDATION_PROTOCOL_INVALID", f"{phase_name} window has an invalid ISO date") from None
            if start_date > end_date:
                raise public_error(422, "VALIDATION_PROTOCOL_INVALID", f"{phase_name} window has an invalid date range")
            phases.append((phase_name, start_date, end_date))
        train, validation, holdout = phases
        if not (
            train[1]
            <= train[2]
            <= validation[1]
            <= validation[2]
            <= holdout[1]
            <= holdout[2]
        ):
            raise public_error(422, "FUTURE_DATA_LEAKAGE", "walk-forward phases must be ordered without future leakage")
        if previous_holdout_end is not None and previous_holdout_end >= train[1]:
            raise public_error(422, "OVERLAPPING_WINDOWS", "walk-forward windows must remain ordered and non-overlapping")
        previous_holdout_end = holdout[2]
    if not all(isinstance(seed, int) for seed in seeds):
        raise public_error(422, "VALIDATION_PROTOCOL_INVALID", "seeds must be integers")
    if not all(isinstance(scenario, dict) and isinstance(scenario.get("name"), str) and scenario["name"] for scenario in scenarios):
        raise public_error(422, "VALIDATION_PROTOCOL_INVALID", "every stress scenario needs a name")
    return windows, seeds, scenarios


@router.get("/experiments/{experiment_id}/validation-runs", operation_id="list_validation_runs_api_v1_experiments__experiment_id__validation_runs_get")
def list_validation_runs(experiment_id: UUIDPath, page: int = Query(1), page_size: int = Query(20), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    _lookup(db, Experiment, experiment_id, "EXPERIMENT_NOT_FOUND")
    values = db.scalars(select(ValidationRun).where(ValidationRun.experiment_id == experiment_id).order_by(ValidationRun.window_index, ValidationRun.seed, ValidationRun.scenario_name, ValidationRun.id)).all()
    return page_response(values, page, page_size, _validation_out)


@router.post("/experiments/{experiment_id}/validation-runs", operation_id="create_validation_runs_api_v1_experiments__experiment_id__validation_runs_post")
def create_validation_runs(experiment_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        experiment = _lookup(db, Experiment, experiment_id, "EXPERIMENT_NOT_FOUND")
        _require_owner(actor, experiment.owner_key)
        protocol = _required_object(body, "protocol")
        windows, seeds, scenarios = _validate_validation_protocol(protocol)
        protocol_sha = content_hash(protocol)
        run_ids: list[str] = []
        for window_index, _window in enumerate(windows):
            for seed in seeds:
                for scenario in scenarios:
                    task = Task(task_type="diagnostic", status="success", owner_key=actor.key, payload={"validation": True})
                    db.add(task)
                    db.flush()
                    result = {"window_index": window_index, "seed": seed, "scenario": scenario["name"], "no_future_data": True}
                    value = ValidationRun(
                        experiment_id=experiment.id,
                        task_id=task.id,
                        protocol_sha256=protocol_sha,
                        window_index=window_index,
                        seed=seed,
                        scenario_name=scenario["name"],
                        status="success",
                        result_completeness="complete",
                        metrics={"total_return": "0", "max_drawdown": "0"},
                        business_result_sha256=content_hash(result),
                        started_at=utcnow(),
                        completed_at=utcnow(),
                    )
                    db.add(value)
                    db.flush()
                    task.run_id = value.id
                    run_ids.append(value.id)
        audit = append_audit(db, actor_key=actor.key, action="validation.create", target="experiment", business_id=experiment.id, request_id=_request_id(request), after={"created_count": len(run_ids), "protocol_sha256": protocol_sha})
        return {"item": {"experiment_id": experiment.id, "protocol_sha256": protocol_sha, "created_count": len(run_ids), "validation_run_ids": run_ids}, "audit_event_id": audit.id}, 202

    return _mutation(db, actor=actor, operation=f"validation.create:{experiment_id}", key=idempotency_key, payload=body, handler=handler)


@router.get("/validation-runs/{run_id}", operation_id="get_validation_run_api_v1_validation_runs__run_id__get")
def get_validation_run(run_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _validation_out(_lookup(db, ValidationRun, run_id, "VALIDATION_RUN_NOT_FOUND"))


@router.get("/risk-events", operation_id="list_risk_events_api_v1_risk_events_get")
def list_risk_events(page: int = Query(1), page_size: int = Query(20), reason_code: str | None = None, run_id: str | None = None, experiment_id: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(RiskEvent).order_by(desc(RiskEvent.created_at), desc(RiskEvent.id))).all()
    if reason_code:
        values = [value for value in values if value.payload.get("reason_code") == reason_code]
    if run_id:
        values = [value for value in values if value.run_id == run_id]
    if experiment_id:
        values = [value for value in values if value.experiment_id == experiment_id]
    return page_response(values, page, page_size, lambda value: {"id": value.id, "experiment_id": value.experiment_id, "run_id": value.run_id, "payload": value.payload, "created_at": value.created_at} | value.payload)


@router.post("/risk-events", operation_id="create_risk_event_api_v1_risk_events_post")
def create_risk_event(request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    payload = _required_object(body, "payload")
    for field in ("contract_version", "reason_code", "symbol", "trade_date"):
        _required_string(payload, field)

    def handler() -> tuple[dict[str, Any], int]:
        experiment_id = body.get("experiment_id")
        run_id = body.get("run_id")
        if experiment_id:
            _lookup(db, Experiment, str(experiment_id), "EXPERIMENT_NOT_FOUND")
        if run_id:
            _lookup(db, Run, str(run_id), "RUN_NOT_FOUND")
        value = RiskEvent(experiment_id=str(experiment_id) if experiment_id else None, run_id=str(run_id) if run_id else None, payload=payload)
        db.add(value)
        db.flush()
        item = {"id": value.id, "experiment_id": value.experiment_id, "run_id": value.run_id, "payload": value.payload, "created_at": value.created_at} | value.payload
        audit = append_audit(db, actor_key=actor.key, action="risk_event.create", target="risk_event", business_id=value.id, request_id=_request_id(request), after=item)
        return {"item": item, "audit_event_id": audit.id}, 201

    return _mutation(db, actor=actor, operation="risk_event.create", key=idempotency_key, payload=body, handler=handler)


@router.get("/experiments/{experiment_id}/risk-coverage", operation_id="risk_coverage_api_v1_experiments__experiment_id__risk_coverage_get")
def risk_coverage(experiment_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    experiment = _lookup(db, Experiment, experiment_id, "EXPERIMENT_NOT_FOUND")
    events = db.scalars(select(RiskEvent).where(RiskEvent.experiment_id == experiment.id)).all()
    totals: dict[str, int] = {}
    for event in events:
        code = str(event.payload.get("reason_code", "UNKNOWN"))
        totals[code] = totals.get(code, 0) + 1
    risk = _lookup(db, ResearchVersion, experiment.risk_rule_version_id)
    return {"experiment_id": experiment.id, "risk_rule_sha256": risk.content_sha256, "total_events": len(events), "by_reason_code": totals}


@router.post("/experiments/{experiment_id}/reports", operation_id="create_report_api_v1_experiments__experiment_id__reports_post")
def create_report(experiment_id: UUIDPath, request: Request, body: dict[str, Any] = Body(...), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        experiment = _lookup(db, Experiment, experiment_id, "EXPERIMENT_NOT_FOUND")
        _require_owner(actor, experiment.owner_key)
        title = _required_string(body, "title")
        content = _canonical_report_content(_required_object(body, "content"))
        run_ids = body.get("run_ids") or []
        if not isinstance(run_ids, list) or not all(isinstance(value, str) for value in run_ids):
            raise public_error(422, "VALIDATION_ERROR", "run_ids must be a list of strings")
        value = Report(owner_key=actor.key, experiment_id=experiment.id, title=title, contract_version=str(content["contract_version"]), content=content, content_sha256=content_hash(content))
        db.add(value)
        db.flush()
        for run_id in run_ids:
            run = _lookup(db, Run, run_id, "RUN_NOT_FOUND")
            if run.experiment_id != experiment.id:
                raise public_error(422, "INVALID_RUN_REFERENCE", "report run must belong to the same experiment")
            db.add(ReportRunLink(report_id=value.id, run_id=run.id))
        audit = append_audit(db, actor_key=actor.key, action="report.create", target="report", business_id=value.id, request_id=_request_id(request), after=_report_out(value))
        return {"item": _report_out(value), "audit_event_id": audit.id}, 201

    return _mutation(db, actor=actor, operation=f"report.create:{experiment_id}", key=idempotency_key, payload=body, handler=handler)


@router.get("/reports", operation_id="list_reports_api_v1_reports_get")
def list_reports(page: int = Query(1), page_size: int = Query(20), experiment_id: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(Report).order_by(desc(Report.created_at), desc(Report.id))).all()
    if experiment_id:
        values = [value for value in values if value.experiment_id == experiment_id]
    return page_response(values, page, page_size, _report_out)


@router.get("/reports/{report_id}", operation_id="get_report_api_v1_reports__report_id__get")
def get_report(report_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _report_out(_lookup(db, Report, report_id, "REPORT_NOT_FOUND"))


@router.get("/reports/{report_id}/content", operation_id="get_report_content_api_v1_reports__report_id__content_get")
def get_report_content(report_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    report = _lookup(db, Report, report_id, "REPORT_NOT_FOUND")
    return {"report": _report_out(report), "content": report.content, "content_sha256": report.content_sha256, "experiment_id": report.experiment_id}


@router.get("/reports/{report_id}/runs", operation_id="list_report_runs_api_v1_reports__report_id__runs_get")
def list_report_runs(report_id: UUIDPath, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> list[dict[str, Any]]:
    _lookup(db, Report, report_id, "REPORT_NOT_FOUND")
    values = db.scalars(select(ReportRunLink).where(ReportRunLink.report_id == report_id).order_by(ReportRunLink.created_at, ReportRunLink.id)).all()
    return [{"report_id": value.report_id, "run_id": value.run_id, "role": value.role, "created_at": value.created_at} for value in values]


def _report_action(db: Session, report_id: str, action: str, request: Request, body: dict[str, Any], actor: Actor, idempotency_key: str) -> JSONResponse:
    def handler() -> tuple[dict[str, Any], int]:
        report = _lookup(db, Report, report_id, "REPORT_NOT_FOUND")
        if action in {"submit", "deprecate"}:
            _require_owner(actor, report.owner_key)
        reason = _required_string(body, "reason")
        before = _report_out(report)
        if action == "submit":
            if report.status != "draft":
                raise public_error(409, "INVALID_REPORT_TRANSITION", "Only draft reports can be submitted")
            report.status, report.submitted_at = "submitted", utcnow()
        elif action == "approve":
            if report.status != "submitted":
                raise public_error(409, "INVALID_REPORT_TRANSITION", "Only submitted reports can be approved")
            report.status, report.approved_by_key, report.approved_at = "approved", actor.key, utcnow()
        else:
            if report.status == "deprecated":
                raise public_error(409, "INVALID_REPORT_TRANSITION", "Report is already deprecated")
            report.status, report.deprecated_by_key, report.deprecated_at = "deprecated", actor.key, utcnow()
        audit = append_audit(db, actor_key=actor.key, action=f"report.{action}", target="report", business_id=report.id, request_id=_request_id(request), reason=reason, before=before, after=_report_out(report))
        return {"item": _report_out(report), "audit_event_id": audit.id}, 200

    return _mutation(db, actor=actor, operation=f"report.{action}:{report_id}", key=idempotency_key, payload=body, handler=handler)


@router.post("/reports/{report_id}/submit", operation_id="submit_report_api_v1_reports__report_id__submit_post")
def submit_report(report_id: UUIDPath, request: Request, body: dict[str, Any] | None = Body(None), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _report_action(db, report_id, "submit", request, body or {}, actor, idempotency_key)


@router.post("/reports/{report_id}/approve", operation_id="approve_report_api_v1_reports__report_id__approve_post")
def approve_report(report_id: UUIDPath, request: Request, body: dict[str, Any] | None = Body(None), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_admin)) -> JSONResponse:
    return _report_action(db, report_id, "approve", request, body or {}, actor, idempotency_key)


@router.post("/reports/{report_id}/deprecate", operation_id="deprecate_report_api_v1_reports__report_id__deprecate_post")
def deprecate_report(report_id: UUIDPath, request: Request, body: dict[str, Any] | None = Body(None), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:write"))) -> JSONResponse:
    return _report_action(db, report_id, "deprecate", request, body or {}, actor, idempotency_key)


@router.post("/reports/{report_id}/export", operation_id="export_report_api_v1_reports__report_id__export_post")
def export_report(report_id: UUIDPath, request: Request, body: dict[str, Any] | None = Body(None), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> JSONResponse:
    payload = body or {}

    def handler() -> tuple[dict[str, Any], int]:
        report = _lookup(db, Report, report_id, "REPORT_NOT_FOUND")
        export_format = str(payload.get("format") or "json")
        if export_format not in {"html", "markdown", "json"}:
            raise public_error(422, "VALIDATION_ERROR", "format must be html, markdown, or json")
        canonical_content = json.dumps(jsonable(report.content), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if export_format == "json":
            text = canonical_content
        elif export_format == "markdown":
            text = f"# {escape(report.title, quote=False)}\n\n```json\n{escape(canonical_content, quote=False)}\n```\n"
        else:
            text = f"<h1>{escape(report.title)}</h1><pre>{escape(canonical_content)}</pre>"
        artifact = Artifact(
            artifact_type="report_export",
            format=export_format,
            size_bytes=len(text.encode("utf-8")),
            sha256=content_hash(text),
            logical_content_sha256=content_hash(report.content),
            content=text,
            storage_kind="artifact",
        )
        db.add(artifact)
        db.flush()
        audit = append_audit(db, actor_key=actor.key, action="report.export", target="report", business_id=report.id, request_id=_request_id(request), after={"artifact_id": artifact.id, "format": export_format})
        return {"report_id": report.id, "format": export_format, "sha256": artifact.sha256, "size_bytes": artifact.size_bytes, "artifact_id": artifact.id, "audit_event_id": audit.id}, 200

    return _mutation(db, actor=actor, operation=f"report.export:{report_id}", key=idempotency_key, payload=payload, handler=handler)


@router.get("/audit-events", operation_id="list_audit_events_api_v1_audit_events_get")
def list_audit_events(page: int = Query(1), page_size: int = Query(20), actor_key: str | None = None, action: str | None = None, target: str | None = None, since: str | None = None, until: str | None = None, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("audit:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(AuditEvent).order_by(desc(AuditEvent.created_at), desc(AuditEvent.id))).all()
    if actor_key:
        values = [value for value in values if value.actor_key == actor_key]
    if action:
        values = [value for value in values if value.action == action]
    if target:
        values = [value for value in values if value.target == target]
    if since:
        values = [value for value in values if value.created_at.isoformat() >= since]
    if until:
        values = [value for value in values if value.created_at.isoformat() <= until]
    return page_response(values, page, page_size, lambda value: {"id": value.id, "actor_key": value.actor_key, "action": value.action, "target": value.target, "business_id": value.business_id, "request_id": value.request_id, "reason": value.reason, "before_json": value.before_json, "after_json": value.after_json, "created_at": value.created_at})


# ---------------------------------------------------------------------------
# G5 paper trading API.  Account ID is optional only when selection is safe.
# ---------------------------------------------------------------------------


@router.get("/paper-trading/snapshot", operation_id="get_snapshot_api_v1_paper_trading_snapshot_get", response_model=PaperSnapshotResponse)
def get_snapshot(account_id: UUID | None = Query(None), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("paper:read"))) -> JSONResponse:
    account = _select_paper_account(db, str(account_id) if account_id else None)
    result = _paper_snapshot(db, account)
    return _validated_paper_commit_json(db, PaperSnapshotResponse, result)


@router.post("/paper-trading/stop", operation_id="stop_account_api_v1_paper_trading_stop_post", response_model=PaperStopResponse)
def stop_paper_account(request: Request, body: PaperStopRequest | None = Body(None), idempotency_key: str = Header(..., alias="Idempotency-Key"), db: Session = Depends(get_db), actor: Actor = Depends(require_admin)) -> JSONResponse:
    payload = body.model_dump(mode="json") if body is not None else {}

    def handler() -> tuple[dict[str, Any], int]:
        account_id = payload.get("account_id")
        account = _select_paper_account(db, str(account_id) if account_id else None)
        reason = str(payload.get("reason") or "manual paper-trading stop").strip()
        if not reason:
            raise public_error(422, "VALIDATION_ERROR", "reason must not be blank")
        before = _paper_account_out(account)
        account.status, account.stop_reason, account.stopped_at = "stopped", reason, utcnow()
        KillSwitch(db).trigger(reason, actor)
        audit = append_audit(db, actor_key=actor.key, action="paper.stop", target="paper_account", business_id=account.id, request_id=_request_id(request), reason=reason, before=before, after=_paper_account_out(account))
        result = {
            "account": _paper_account_out(account),
            "snapshot": _paper_snapshot(db, account),
            "audit_event_id": audit.id,
        }
        # Validate before execute_idempotent serializes and stores the first
        # response, so replays cannot preserve an unvalidated payload.
        return _validated_paper_payload(PaperStopResponse, result), 200

    return _mutation(db, actor=actor, operation="paper.stop", key=idempotency_key, payload=payload, handler=handler)


@router.get("/paper-trading/orders", operation_id="list_orders_api_v1_paper_trading_orders_get", response_model=PaperOrdersResponse)
def list_paper_orders(account_id: UUID | None = Query(None), status: OrderStatus | None = Query(None), page: int | None = Query(None, ge=1), page_size: int = Query(20, ge=1, le=100), cursor: int | None = Query(None, ge=0), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("paper:read"))) -> JSONResponse:
    account = _select_paper_account(db, str(account_id) if account_id else None)
    values = db.scalars(select(PaperOrder).where(PaperOrder.account_id == account.id).order_by(desc(PaperOrder.created_at), desc(PaperOrder.id))).all()
    if status:
        values = [value for value in values if value.status == status.value]
    if page is not None:
        result = page_response(values, page, page_size, _paper_order_out)
    else:
        result = cursor_page_response(values, cursor, page_size, _paper_order_out)
    return _validated_paper_commit_json(db, PaperOrdersResponse, result)


@router.get("/paper-trading/orders/{order_id}", operation_id="get_order_api_v1_paper_trading_orders__order_id__get", response_model=PaperOrderResponse)
def get_paper_order(order_id: UUID, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("paper:read"))) -> dict[str, Any]:
    return _validated_paper_payload(PaperOrderResponse, _paper_order_out(_lookup(db, PaperOrder, str(order_id), "PAPER_ORDER_NOT_FOUND")))


@router.get("/paper-trading/reconciliations", operation_id="list_reconciliations_api_v1_paper_trading_reconciliations_get", response_model=PaperReconciliationsResponse)
def list_reconciliations(account_id: UUID | None = Query(None), page: int | None = Query(None, ge=1), page_size: int = Query(20, ge=1, le=100), cursor: int | None = Query(None, ge=0), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("paper:read"))) -> JSONResponse:
    account = _select_paper_account(db, str(account_id) if account_id else None)
    values = db.scalars(select(ReconciliationRun).where(ReconciliationRun.account_id == account.id).order_by(desc(ReconciliationRun.created_at), desc(ReconciliationRun.id))).all()
    result = page_response(values, page, page_size, _reconciliation_out) if page is not None else cursor_page_response(values, cursor, page_size, _reconciliation_out)
    return _validated_paper_commit_json(db, PaperReconciliationsResponse, result)


@router.get("/paper-trading/reconciliations/{run_id}", operation_id="get_reconciliation_api_v1_paper_trading_reconciliations__run_id__get", response_model=PaperReconciliationDetailResponse)
def get_reconciliation(run_id: UUID, db: Session = Depends(get_db), actor: Actor = Depends(require_scope("paper:read"))) -> dict[str, Any]:
    value = _lookup(db, ReconciliationRun, str(run_id), "RECONCILIATION_NOT_FOUND")
    run = _reconciliation_out(value)
    return _validated_paper_payload(PaperReconciliationDetailResponse, run | {"run": run, "items": value.discrepancies})


@router.get("/paper-trading/daily-report", operation_id="get_daily_report_api_v1_paper_trading_daily_report_get", response_model=PaperDailyReportResponse)
def get_daily_report(account_id: UUID | None = Query(None), report_date: calendar_date | None = Query(None, alias="date"), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("paper:read"))) -> JSONResponse:
    account = _select_paper_account(db, str(account_id) if account_id else None)
    report_date = report_date or utcnow().date()
    return _validated_paper_commit_json(db, PaperDailyReportResponse, daily_report(db, account, report_date))


# Existing placeholder-era compatibility aliases.  They remain isolated from
# the historical OpenAPI contract and intentionally delegate to the same
# recovered containers rather than registering ambiguous duplicate paths.
@router.get("/risk/rules", include_in_schema=False)
def legacy_list_risk_rules(page: int = Query(1), page_size: int = Query(20), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    return _list_containers("risk_rule_set", page, page_size, None, None, None, db)


@router.get("/runs", include_in_schema=False)
def legacy_list_runs(page: int = Query(1), page_size: int = Query(20), db: Session = Depends(get_db), actor: Actor = Depends(require_scope("research:read"))) -> dict[str, Any]:
    _page_args(page, page_size)
    values = db.scalars(select(Run).order_by(desc(Run.created_at), desc(Run.id))).all()
    return page_response(values, page, page_size, _run_out)
