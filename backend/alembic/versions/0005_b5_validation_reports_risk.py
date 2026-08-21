"""Reconstructed baseline for the retained B0--B5 research contract.

This is a new baseline inferred from the local OpenAPI/front-end evidence, not
a recovered copy of the lost historical migration source.

Revision ID: 0005_b5_validation_reports_risk
Revises:
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_b5_validation_reports_risk"
down_revision = None
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "idempotency_records",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("actor_key", sa.String(128), nullable=False),
        sa.Column("operation", sa.String(180), nullable=False),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("payload_sha256", sa.String(64), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("actor_key", "operation", "idempotency_key", name="uq_idempotency_actor_operation_key"),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("actor_key", sa.String(128), nullable=False),
        sa.Column("action", sa.String(160), nullable=False),
        sa.Column("target", sa.String(160), nullable=False),
        sa.Column("business_id", sa.String(64)),
        sa.Column("request_id", sa.String(128)),
        sa.Column("reason", sa.Text()),
        sa.Column("before_json", sa.JSON()),
        sa.Column("after_json", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_audit_events_created", "audit_events", ["created_at", "id"])
    op.create_table(
        "data_sources",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(160), nullable=False, unique=True),
        sa.Column("adapter", sa.String(120), nullable=False),
        sa.Column("license_ref", sa.String(500), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_table(
        "datasets",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("market", sa.String(64), nullable=False),
        sa.Column("frequency", sa.String(64), nullable=False, server_default="daily"),
        sa.Column("schema_version", sa.String(64), nullable=False, server_default="dataset_v1"),
        sa.Column("license", sa.String(500), nullable=False, server_default="local-reconstructed"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_table(
        "dataset_versions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("dataset_id", UUID, sa.ForeignKey("datasets.id"), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="available"),
        sa.Column("quality_status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("quality_summary", sa.JSON()),
        sa.Column("time_start", sa.String(64), nullable=False),
        sa.Column("time_end", sa.String(64), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Asia/Shanghai"),
        sa.Column("adjustment", sa.String(32), nullable=False, server_default="none"),
        sa.Column("symbols", sa.JSON(), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parent_version_id", UUID, sa.ForeignKey("dataset_versions.id")),
        sa.Column("data_source_id", UUID, sa.ForeignKey("data_sources.id")),
        sa.Column("source", sa.JSON()),
        sa.Column("task_id", UUID),
        sa.Column("manifest", sa.JSON()),
        sa.Column("manifest_sha256", sa.String(64)),
        sa.Column("logical_content_sha256", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("dataset_id", "version_no", name="uq_dataset_version_no"),
    )
    op.create_index("ix_dataset_versions_dataset", "dataset_versions", ["dataset_id", "version_no"])
    op.create_table(
        "data_quality_runs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("version_id", UUID, sa.ForeignKey("dataset_versions.id"), nullable=False),
        sa.Column("task_id", UUID, nullable=False),
        sa.Column("rule_set_version", sa.String(160), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("blocking_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("warning_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("report_artifact_id", UUID),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_data_quality_runs_version", "data_quality_runs", ["version_id", "created_at"])
    op.create_table(
        "research_containers",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("container_type", sa.String(32), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("owner_key", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("container_type", "slug", name="uq_research_container_type_slug"),
    )
    op.create_index("ix_research_containers_type", "research_containers", ["container_type", "created_at"])
    op.create_table(
        "research_versions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("container_id", UUID, sa.ForeignKey("research_containers.id"), nullable=False),
        sa.Column("container_type", sa.String(32), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("parent_version_id", UUID, sa.ForeignKey("research_versions.id")),
        sa.Column("note", sa.Text()),
        sa.Column("created_by_key", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("frozen_at", sa.DateTime(timezone=True)),
        sa.Column("frozen_by_key", sa.String(128)),
        sa.Column("freeze_reason", sa.Text()),
        sa.Column("deprecated_at", sa.DateTime(timezone=True)),
        sa.Column("deprecated_by_key", sa.String(128)),
        sa.Column("deprecate_reason", sa.Text()),
        sa.Column("contract_name", sa.String(160), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.UniqueConstraint("container_id", "version_no", name="uq_research_version_no"),
    )
    op.create_index("ix_research_versions_container", "research_versions", ["container_id", "version_no"])
    op.create_table(
        "tasks",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("task_type", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("owner_key", sa.String(128)),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("payload", sa.JSON()),
        sa.Column("run_id", UUID),
        sa.Column("error_code", sa.String(128)),
        sa.Column("error_message", sa.Text()),
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_tasks_created", "tasks", ["created_at", "id"])
    op.create_table(
        "experiments",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("owner_key", sa.String(128), nullable=False),
        sa.Column("protocol", sa.JSON(), nullable=False),
        sa.Column("protocol_sha256", sa.String(64), nullable=False),
        sa.Column("dataset_version_id", UUID, sa.ForeignKey("dataset_versions.id"), nullable=False),
        sa.Column("strategy_version_id", UUID, sa.ForeignKey("research_versions.id"), nullable=False),
        sa.Column("model_version_id", UUID, sa.ForeignKey("research_versions.id"), nullable=False),
        sa.Column("risk_rule_version_id", UUID, sa.ForeignKey("research_versions.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("frozen_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_experiments_created", "experiments", ["created_at", "id"])
    op.create_table(
        "runs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("experiment_id", UUID, sa.ForeignKey("experiments.id"), nullable=False),
        sa.Column("task_id", UUID, sa.ForeignKey("tasks.id"), nullable=False),
        sa.Column("source_run_id", UUID, sa.ForeignKey("runs.id")),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("run_manifest", sa.JSON(), nullable=False),
        sa.Column("run_manifest_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("result_completeness", sa.String(32), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("business_result_sha256", sa.String(64)),
        sa.Column("error_code", sa.String(128)),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_runs_experiment_created", "runs", ["experiment_id", "created_at"])
    op.create_index("ix_runs_fingerprint", "runs", ["fingerprint"])
    op.create_table(
        "artifacts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("run_id", UUID, sa.ForeignKey("runs.id")),
        sa.Column("task_id", UUID, sa.ForeignKey("tasks.id")),
        sa.Column("artifact_type", sa.String(120), nullable=False),
        sa.Column("format", sa.String(32), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64)),
        sa.Column("logical_content_sha256", sa.String(64)),
        sa.Column("row_count", sa.Integer()),
        sa.Column("completeness", sa.String(32), nullable=False),
        sa.Column("storage_kind", sa.String(32), nullable=False),
        sa.Column("schema_version", sa.String(64)),
        sa.Column("generated_by_task_id", UUID),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_artifacts_run", "artifacts", ["run_id", "created_at"])
    op.create_index("ix_artifacts_task", "artifacts", ["task_id", "created_at"])
    op.create_table(
        "validation_runs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("experiment_id", UUID, sa.ForeignKey("experiments.id"), nullable=False),
        sa.Column("task_id", UUID, sa.ForeignKey("tasks.id")),
        sa.Column("protocol_sha256", sa.String(64), nullable=False),
        sa.Column("window_index", sa.Integer(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("scenario_name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("result_completeness", sa.String(32), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("business_result_sha256", sa.String(64)),
        sa.Column("error_code", sa.String(128)),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_validation_runs_experiment", "validation_runs", ["experiment_id", "window_index", "seed"])
    op.create_table(
        "risk_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("experiment_id", UUID, sa.ForeignKey("experiments.id")),
        sa.Column("run_id", UUID, sa.ForeignKey("runs.id")),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_risk_events_experiment", "risk_events", ["experiment_id", "created_at"])
    op.create_index("ix_risk_events_run", "risk_events", ["run_id", "created_at"])
    op.create_table(
        "reports",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("owner_key", sa.String(128), nullable=False),
        sa.Column("experiment_id", UUID, sa.ForeignKey("experiments.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("contract_version", sa.String(64), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("approved_by_key", sa.String(128)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("deprecated_by_key", sa.String(128)),
        sa.Column("deprecated_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_reports_experiment_created", "reports", ["experiment_id", "created_at"])
    op.create_table(
        "report_run_links",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("report_id", UUID, sa.ForeignKey("reports.id"), nullable=False),
        sa.Column("run_id", UUID, sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False, server_default="primary"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("report_id", "run_id", name="uq_report_run_link"),
    )
    op.create_index("ix_report_run_links_report", "report_run_links", ["report_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_report_run_links_report", table_name="report_run_links")
    op.drop_table("report_run_links")
    op.drop_index("ix_reports_experiment_created", table_name="reports")
    op.drop_table("reports")
    op.drop_index("ix_risk_events_run", table_name="risk_events")
    op.drop_index("ix_risk_events_experiment", table_name="risk_events")
    op.drop_table("risk_events")
    op.drop_index("ix_validation_runs_experiment", table_name="validation_runs")
    op.drop_table("validation_runs")
    op.drop_index("ix_artifacts_task", table_name="artifacts")
    op.drop_index("ix_artifacts_run", table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index("ix_runs_fingerprint", table_name="runs")
    op.drop_index("ix_runs_experiment_created", table_name="runs")
    op.drop_table("runs")
    op.drop_index("ix_experiments_created", table_name="experiments")
    op.drop_table("experiments")
    op.drop_index("ix_tasks_created", table_name="tasks")
    op.drop_table("tasks")
    op.drop_index("ix_research_versions_container", table_name="research_versions")
    op.drop_table("research_versions")
    op.drop_index("ix_research_containers_type", table_name="research_containers")
    op.drop_table("research_containers")
    op.drop_index("ix_data_quality_runs_version", table_name="data_quality_runs")
    op.drop_table("data_quality_runs")
    op.drop_index("ix_dataset_versions_dataset", table_name="dataset_versions")
    op.drop_table("dataset_versions")
    op.drop_table("datasets")
    op.drop_table("data_sources")
    op.drop_index("ix_audit_events_created", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_table("idempotency_records")
