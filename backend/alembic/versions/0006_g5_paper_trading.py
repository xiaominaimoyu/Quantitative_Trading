"""Add reconstructed G5 paper-trading and G6 paper-safety persistence.

Revision ID: 0006_g5_paper_trading
Revises: e2aac586a3cd
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_g5_paper_trading"
down_revision = "e2aac586a3cd"
branch_labels = None
depends_on = None


UUID = sa.Uuid(as_uuid=False)
MONEY = sa.Numeric(24, 8)


def upgrade() -> None:
    op.create_table(
        "paper_account",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("initial_capital", MONEY, nullable=False),
        sa.Column("cash", MONEY, nullable=False),
        sa.Column("stop_reason", sa.Text()),
        sa.Column("stopped_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("status IN ('active', 'stopped', 'error')", name="ck_paper_account_status"),
        sa.CheckConstraint("initial_capital >= 0", name="ck_paper_account_initial_capital_nonnegative"),
        sa.CheckConstraint("cash >= 0", name="ck_paper_account_cash_nonnegative"),
    )
    op.create_table(
        "paper_order",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("account_id", UUID, sa.ForeignKey("paper_account.id"), nullable=False),
        sa.Column("client_order_id", sa.String(160), nullable=False),
        sa.Column("broker_order_id", sa.String(160)),
        sa.Column("symbol", sa.String(64), nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("side", sa.String(8), nullable=False),
        sa.Column("order_type", sa.String(16), nullable=False),
        sa.Column("quantity", MONEY, nullable=False),
        sa.Column("price", MONEY),
        sa.Column("filled_quantity", MONEY, nullable=False, server_default="0"),
        sa.Column("avg_fill_price", MONEY),
        sa.Column("status", sa.String(32), nullable=False, server_default="planned"),
        sa.Column("error_code", sa.String(128)),
        sa.Column("error_message", sa.Text()),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("client_order_id", name="uq_paper_order_client_order_id"),
        sa.CheckConstraint("side IN ('buy', 'sell')", name="ck_paper_order_side"),
        sa.CheckConstraint("quantity > 0", name="ck_paper_order_quantity_positive"),
        sa.CheckConstraint("price IS NULL OR price >= 0", name="ck_paper_order_price_nonnegative"),
        sa.CheckConstraint("filled_quantity >= 0", name="ck_paper_order_filled_quantity_nonnegative"),
        sa.CheckConstraint("filled_quantity <= quantity", name="ck_paper_order_filled_quantity_lte_quantity"),
        sa.CheckConstraint(
            "status IN ('planned', 'blocked', 'submitting', 'submitted', 'unknown', "
            "'partially_filled', 'filled', 'cancel_pending', 'cancelled', 'rejected')",
            name="ck_paper_order_status",
        ),
    )
    op.create_index("ix_paper_order_account_created", "paper_order", ["account_id", "created_at"])
    op.create_index("ix_paper_order_status", "paper_order", ["status"])
    op.create_table(
        "paper_fill",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("order_id", UUID, sa.ForeignKey("paper_order.id"), nullable=False),
        sa.Column("broker_fill_id", sa.String(160), nullable=False),
        sa.Column("symbol", sa.String(64), nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("side", sa.String(8), nullable=False),
        sa.Column("quantity", MONEY, nullable=False),
        sa.Column("price", MONEY, nullable=False),
        sa.Column("fee", MONEY, nullable=False, server_default="0"),
        sa.Column("fill_timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("broker_fill_id", name="uq_paper_fill_broker_fill_id"),
        sa.CheckConstraint("side IN ('buy', 'sell')", name="ck_paper_fill_side"),
        sa.CheckConstraint("quantity > 0", name="ck_paper_fill_quantity_positive"),
        sa.CheckConstraint("price >= 0", name="ck_paper_fill_price_nonnegative"),
        sa.CheckConstraint("fee >= 0", name="ck_paper_fill_fee_nonnegative"),
    )
    op.create_index("ix_paper_fill_order", "paper_fill", ["order_id", "fill_timestamp"])
    op.create_table(
        "reconciliation_run",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("account_id", UUID, sa.ForeignKey("paper_account.id"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="completed"),
        sa.Column("result_status", sa.String(32), nullable=False, server_default="matched"),
        sa.Column("discrepancies", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("checked_targets_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("differences_count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("status IN ('running', 'completed', 'failed')", name="ck_reconciliation_run_status"),
        sa.CheckConstraint("result_status IN ('matched', 'difference')", name="ck_reconciliation_run_result_status"),
        sa.CheckConstraint("checked_targets_count >= 0", name="ck_reconciliation_run_checked_targets_nonnegative"),
        sa.CheckConstraint("differences_count >= 0", name="ck_reconciliation_run_differences_nonnegative"),
    )
    op.create_index("ix_reconciliation_run_account", "reconciliation_run", ["account_id", "created_at"])
    op.create_table(
        "paper_safety_state",
        sa.Column("scope", sa.String(80), primary_key=True),
        sa.Column("is_triggered", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.Text()),
        sa.Column("triggered_by", sa.String(128)),
        sa.Column("triggered_at", sa.DateTime(timezone=True)),
        sa.Column("recovered_by", sa.String(128)),
        sa.Column("recovered_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("scope = 'paper-trading'", name="ck_paper_safety_state_scope"),
    )


def downgrade() -> None:
    op.drop_table("paper_safety_state")
    op.drop_index("ix_reconciliation_run_account", table_name="reconciliation_run")
    op.drop_table("reconciliation_run")
    op.drop_index("ix_paper_fill_order", table_name="paper_fill")
    op.drop_table("paper_fill")
    op.drop_index("ix_paper_order_status", table_name="paper_order")
    op.drop_index("ix_paper_order_account_created", table_name="paper_order")
    op.drop_table("paper_order")
    op.drop_table("paper_account")
