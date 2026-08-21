"""Add reconstructed local worker queue and heartbeat persistence.

Revision ID: 0007_recovered_worker_queue
Revises: 0006_g5_paper_trading
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_recovered_worker_queue"
down_revision = "0006_g5_paper_trading"
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=False)


def upgrade() -> None:
    op.add_column("tasks", sa.Column("worker_id", sa.String(160), nullable=True))
    op.add_column("tasks", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("tasks", "status", existing_type=sa.String(32), server_default="queued")
    op.alter_column("tasks", "priority", existing_type=sa.Integer(), server_default="100")
    op.alter_column("tasks", "max_attempts", existing_type=sa.Integer(), server_default="3")
    op.alter_column("tasks", "progress", existing_type=sa.Integer(), server_default="0")
    op.create_check_constraint(
        "ck_tasks_task_type",
        "tasks",
        "task_type IN ('diagnostic', 'data_ingest', 'data_quality', 'backtest')",
    )
    op.create_check_constraint(
        "ck_tasks_status",
        "tasks",
        "status IN ('queued', 'claimed', 'running', 'cancel_requested', 'success', 'failed', 'canceled')",
    )
    op.create_check_constraint("ck_tasks_priority_range", "tasks", "priority >= 0 AND priority <= 1000")
    op.create_check_constraint("ck_tasks_attempt_count_nonnegative", "tasks", "attempt_count >= 0")
    op.create_check_constraint("ck_tasks_max_attempts_positive", "tasks", "max_attempts >= 1")
    op.create_check_constraint("ck_tasks_progress_range", "tasks", "progress >= 0 AND progress <= 100")
    op.create_index("ix_tasks_queue_claim", "tasks", ["status", "priority", "created_at", "id"])
    op.create_index("ix_tasks_worker", "tasks", ["worker_id"])
    op.create_index("ix_tasks_lease_expires", "tasks", ["lease_expires_at"])
    op.create_unique_constraint("uq_artifacts_task_type", "artifacts", ["task_id", "artifact_type"])
    op.create_table(
        "worker_heartbeats",
        sa.Column("worker_id", sa.String(160), primary_key=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("current_task_id", UUID, sa.ForeignKey("tasks.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_worker_heartbeats_last_seen", "worker_heartbeats", ["last_seen_at"])


def downgrade() -> None:
    op.drop_index("ix_worker_heartbeats_last_seen", table_name="worker_heartbeats")
    op.drop_table("worker_heartbeats")
    op.drop_constraint("uq_artifacts_task_type", "artifacts", type_="unique")
    op.drop_index("ix_tasks_lease_expires", table_name="tasks")
    op.drop_index("ix_tasks_worker", table_name="tasks")
    op.drop_index("ix_tasks_queue_claim", table_name="tasks")
    op.drop_constraint("ck_tasks_progress_range", "tasks", type_="check")
    op.drop_constraint("ck_tasks_max_attempts_positive", "tasks", type_="check")
    op.drop_constraint("ck_tasks_attempt_count_nonnegative", "tasks", type_="check")
    op.drop_constraint("ck_tasks_priority_range", "tasks", type_="check")
    op.drop_constraint("ck_tasks_status", "tasks", type_="check")
    op.drop_constraint("ck_tasks_task_type", "tasks", type_="check")
    op.alter_column("tasks", "progress", existing_type=sa.Integer(), server_default="100")
    op.alter_column("tasks", "max_attempts", existing_type=sa.Integer(), server_default="1")
    op.alter_column("tasks", "priority", existing_type=sa.Integer(), server_default="0")
    op.alter_column("tasks", "status", existing_type=sa.String(32), server_default=None)
    op.drop_column("tasks", "lease_expires_at")
    op.drop_column("tasks", "started_at")
    op.drop_column("tasks", "claimed_at")
    op.drop_column("tasks", "worker_id")
