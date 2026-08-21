"""Persistent models reconstructed from the retained public API contract.

These tables intentionally use SQLAlchemy's portable types so the recovered
service can be exercised against isolated SQLite databases as well as the
documented PostgreSQL deployment.  They do not model a broker connection or a
real-money account.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from quant_trading.core.database import Base


def new_id() -> str:
    """Return a portable UUID value in the string form used by the API."""

    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


UUID_STR = Uuid(as_uuid=False)
MONEY = Numeric(24, 8)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (
        UniqueConstraint("actor_key", "operation", "idempotency_key", name="uq_idempotency_actor_operation_key"),
    )

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    actor_key: Mapped[str] = mapped_column(String(128), nullable=False)
    operation: Mapped[str] = mapped_column(String(180), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    response_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    actor_key: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(160), nullable=False)
    target: Mapped[str] = mapped_column(String(160), nullable=False)
    business_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    after_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    adapter: Mapped[str] = mapped_column(String(120), nullable=False)
    license_ref: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    market: Mapped[str] = mapped_column(String(64), nullable=False)
    frequency: Mapped[str] = mapped_column(String(64), default="daily", nullable=False)
    schema_version: Mapped[str] = mapped_column(String(64), default="dataset_v1", nullable=False)
    license: Mapped[str] = mapped_column(String(500), default="local-reconstructed", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"
    __table_args__ = (UniqueConstraint("dataset_id", "version_no", name="uq_dataset_version_no"),)

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("datasets.id"), nullable=False, index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="available", nullable=False)
    quality_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    quality_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    time_start: Mapped[str] = mapped_column(String(64), nullable=False)
    time_end: Mapped[str] = mapped_column(String(64), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Shanghai", nullable=False)
    adjustment: Mapped[str] = mapped_column(String(32), default="none", nullable=False)
    symbols: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parent_version_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("dataset_versions.id"), nullable=True)
    data_source_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("data_sources.id"), nullable=True)
    source: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    task_id: Mapped[str | None] = mapped_column(UUID_STR, nullable=True)
    manifest: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    manifest_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logical_content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class DataQualityRun(Base):
    __tablename__ = "data_quality_runs"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    version_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("dataset_versions.id"), nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(UUID_STR, nullable=False)
    rule_set_version: Mapped[str] = mapped_column(String(160), default="local-quality-v1", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="passed", nullable=False)
    blocking_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    warning_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    report_artifact_id: Mapped[str | None] = mapped_column(UUID_STR, nullable=True)
    results: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResearchContainer(Base):
    __tablename__ = "research_containers"
    __table_args__ = (UniqueConstraint("container_type", "slug", name="uq_research_container_type_slug"),)

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    container_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_key: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class ResearchVersion(Base):
    __tablename__ = "research_versions"
    __table_args__ = (UniqueConstraint("container_id", "version_no", name="uq_research_version_no"),)

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    container_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("research_containers.id"), nullable=False, index=True)
    container_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    parent_version_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("research_versions.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_key: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    frozen_by_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    freeze_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    deprecated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deprecated_by_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    deprecate_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    contract_name: Mapped[str] = mapped_column(String(160), default="reconstructed_contract_v1", nullable=False)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    owner_key: Mapped[str] = mapped_column(String(128), nullable=False)
    protocol: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    protocol_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_version_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("dataset_versions.id"), nullable=False)
    strategy_version_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("research_versions.id"), nullable=False)
    model_version_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("research_versions.id"), nullable=False)
    risk_rule_version_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("research_versions.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="frozen", nullable=False)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "task_type IN ('diagnostic', 'data_ingest', 'data_quality', 'backtest')",
            name="ck_tasks_task_type",
        ),
        CheckConstraint(
            "status IN ('queued', 'claimed', 'running', 'cancel_requested', 'success', 'failed', 'canceled')",
            name="ck_tasks_status",
        ),
        CheckConstraint("priority >= 0 AND priority <= 1000", name="ck_tasks_priority_range"),
        CheckConstraint("attempt_count >= 0", name="ck_tasks_attempt_count_nonnegative"),
        CheckConstraint("max_attempts >= 1", name="ck_tasks_max_attempts_positive"),
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_tasks_progress_range"),
        Index("ix_tasks_queue_claim", "status", "priority", "created_at", "id"),
        Index("ix_tasks_worker", "worker_id"),
        Index("ix_tasks_lease_expires", "lease_expires_at"),
    )

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    task_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    owner_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    run_id: Mapped[str | None] = mapped_column(UUID_STR, nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    experiment_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("experiments.id"), nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("tasks.id"), nullable=False)
    source_run_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("runs.id"), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    run_manifest: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    run_manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="success", nullable=False)
    result_completeness: Mapped[str] = mapped_column(String(32), default="complete", nullable=False)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    business_result_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (
        UniqueConstraint("task_id", "artifact_type", name="uq_artifacts_task_type"),
    )

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    run_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("runs.id"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("tasks.id"), nullable=True, index=True)
    artifact_type: Mapped[str] = mapped_column(String(120), nullable=False)
    format: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logical_content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completeness: Mapped[str] = mapped_column(String(32), default="complete", nullable=False)
    storage_kind: Mapped[str] = mapped_column(String(32), default="artifact", nullable=False)
    schema_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    generated_by_task_id: Mapped[str | None] = mapped_column(UUID_STR, nullable=True)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class WorkerHeartbeat(Base):
    """Persistent local-worker liveness evidence; never a remote queue lease."""

    __tablename__ = "worker_heartbeats"
    __table_args__ = (Index("ix_worker_heartbeats_last_seen", "last_seen_at"),)

    worker_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    current_task_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("tasks.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class ValidationRun(Base):
    __tablename__ = "validation_runs"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    experiment_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("experiments.id"), nullable=False, index=True)
    task_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("tasks.id"), nullable=True)
    protocol_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    window_index: Mapped[int] = mapped_column(Integer, nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    scenario_name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="success", nullable=False)
    result_completeness: Mapped[str] = mapped_column(String(32), default="complete", nullable=False)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    business_result_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)


class RiskEvent(Base):
    __tablename__ = "risk_events"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    experiment_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("experiments.id"), nullable=True, index=True)
    run_id: Mapped[str | None] = mapped_column(UUID_STR, ForeignKey("runs.id"), nullable=True, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    owner_key: Mapped[str] = mapped_column(String(128), nullable=False)
    experiment_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("experiments.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    contract_version: Mapped[str] = mapped_column(String(64), default="report_content_v1", nullable=False)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deprecated_by_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    deprecated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class ReportRunLink(Base):
    __tablename__ = "report_run_links"
    __table_args__ = (UniqueConstraint("report_id", "run_id", name="uq_report_run_link"),)

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    report_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("reports.id"), nullable=False, index=True)
    run_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("runs.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(32), default="primary", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PaperAccount(Base):
    """A locally persisted simulation account; never a broker account."""

    __tablename__ = "paper_account"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'stopped', 'error')", name="ck_paper_account_status"),
        CheckConstraint("initial_capital >= 0", name="ck_paper_account_initial_capital_nonnegative"),
        CheckConstraint("cash >= 0", name="ck_paper_account_cash_nonnegative"),
    )

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    initial_capital: Mapped[Any] = mapped_column(MONEY, nullable=False)
    cash: Mapped[Any] = mapped_column(MONEY, nullable=False)
    stop_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class PaperOrder(Base):
    __tablename__ = "paper_order"
    __table_args__ = (
        UniqueConstraint("client_order_id", name="uq_paper_order_client_order_id"),
        Index("ix_paper_order_account_created", "account_id", "created_at"),
        CheckConstraint("side IN ('buy', 'sell')", name="ck_paper_order_side"),
        CheckConstraint("quantity > 0", name="ck_paper_order_quantity_positive"),
        CheckConstraint("price IS NULL OR price >= 0", name="ck_paper_order_price_nonnegative"),
        CheckConstraint("filled_quantity >= 0", name="ck_paper_order_filled_quantity_nonnegative"),
        CheckConstraint("filled_quantity <= quantity", name="ck_paper_order_filled_quantity_lte_quantity"),
        CheckConstraint(
            "status IN ('planned', 'blocked', 'submitting', 'submitted', 'unknown', "
            "'partially_filled', 'filled', 'cancel_pending', 'cancelled', 'rejected')",
            name="ck_paper_order_status",
        ),
    )

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("paper_account.id"), nullable=False, index=True)
    client_order_id: Mapped[str] = mapped_column(String(160), nullable=False)
    broker_order_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    symbol: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    order_type: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[Any] = mapped_column(MONEY, nullable=False)
    price: Mapped[Any | None] = mapped_column(MONEY, nullable=True)
    filled_quantity: Mapped[Any] = mapped_column(MONEY, default=0, nullable=False)
    avg_fill_price: Mapped[Any | None] = mapped_column(MONEY, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="planned", nullable=False, index=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class PaperFill(Base):
    __tablename__ = "paper_fill"
    __table_args__ = (
        UniqueConstraint("broker_fill_id", name="uq_paper_fill_broker_fill_id"),
        CheckConstraint("side IN ('buy', 'sell')", name="ck_paper_fill_side"),
        CheckConstraint("quantity > 0", name="ck_paper_fill_quantity_positive"),
        CheckConstraint("price >= 0", name="ck_paper_fill_price_nonnegative"),
        CheckConstraint("fee >= 0", name="ck_paper_fill_fee_nonnegative"),
    )

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    order_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("paper_order.id"), nullable=False, index=True)
    broker_fill_id: Mapped[str] = mapped_column(String(160), nullable=False)
    symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    quantity: Mapped[Any] = mapped_column(MONEY, nullable=False)
    price: Mapped[Any] = mapped_column(MONEY, nullable=False)
    fee: Mapped[Any] = mapped_column(MONEY, default=0, nullable=False)
    fill_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class ReconciliationRun(Base):
    __tablename__ = "reconciliation_run"
    __table_args__ = (
        CheckConstraint("status IN ('running', 'completed', 'failed')", name="ck_reconciliation_run_status"),
        CheckConstraint("result_status IN ('matched', 'difference')", name="ck_reconciliation_run_result_status"),
        CheckConstraint("checked_targets_count >= 0", name="ck_reconciliation_run_checked_targets_nonnegative"),
        CheckConstraint("differences_count >= 0", name="ck_reconciliation_run_differences_nonnegative"),
    )

    id: Mapped[str] = mapped_column(UUID_STR, primary_key=True, default=new_id)
    account_id: Mapped[str] = mapped_column(UUID_STR, ForeignKey("paper_account.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    result_status: Mapped[str] = mapped_column(String(32), default="matched", nullable=False)
    discrepancies: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    checked_targets_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    differences_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SafetyState(Base):
    __tablename__ = "paper_safety_state"
    __table_args__ = (CheckConstraint("scope = 'paper-trading'", name="ck_paper_safety_state_scope"),)

    scope: Mapped[str] = mapped_column(String(80), primary_key=True, default="paper-trading")
    is_triggered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recovered_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    recovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


RECOVERY_TABLES = [
    IdempotencyRecord.__table__,
    AuditEvent.__table__,
    DataSource.__table__,
    Dataset.__table__,
    DatasetVersion.__table__,
    DataQualityRun.__table__,
    ResearchContainer.__table__,
    ResearchVersion.__table__,
    Experiment.__table__,
    Task.__table__,
    Run.__table__,
    Artifact.__table__,
    WorkerHeartbeat.__table__,
    ValidationRun.__table__,
    RiskEvent.__table__,
    Report.__table__,
    ReportRunLink.__table__,
    PaperAccount.__table__,
    PaperOrder.__table__,
    PaperFill.__table__,
    ReconciliationRun.__table__,
    SafetyState.__table__,
]
