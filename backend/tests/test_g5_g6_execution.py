from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from quant_trading.core.auth import Actor
from quant_trading.execution.adapter import BrokerOrderReceipt, BrokerUnavailable, build_adapter
from quant_trading.execution.orders import ALLOWED_TRANSITIONS, InvalidOrderTransition, OrderStatus, apply_fill, transition_order
from quant_trading.execution.recovery import PaperRecoveryService
from quant_trading.execution.report import daily_report, paper_positions
from quant_trading.execution.reconciliation import BrokerObservation, reconcile_orders
from quant_trading.execution.safety import (
    DailyLossTracker,
    KillSwitch,
    SafetyLimits,
    SafetyViolation,
    TradingHalted,
    UncertainOrderState,
    check_uncertain_state,
    pre_trade_check,
)
from quant_trading.models.recovery import AuditEvent, PaperAccount, PaperFill, PaperOrder, ReconciliationRun, SafetyState


class _ReceiptAdapter:
    """Local receipt source for recovery tests; it has no broker side effect."""

    name = "test-receipt"

    def __init__(self, status: str, broker_order_id: str = "receipt-order"):
        self.status = status
        self.broker_order_id = broker_order_id

    def availability(self) -> tuple[bool, str | None]:
        return True, None

    def submit_paper_order(self, client_order_id: str, payload: dict[str, object]) -> BrokerOrderReceipt:
        return BrokerOrderReceipt(client_order_id, self.broker_order_id, self.status)

    def query_paper_order(self, broker_order_id: str | None, client_order_id: str) -> BrokerOrderReceipt:
        return BrokerOrderReceipt(client_order_id, self.broker_order_id, self.status)


def _account(db: Session) -> PaperAccount:
    value = PaperAccount(name="paper", initial_capital=Decimal("1000"), cash=Decimal("1000"))
    db.add(value)
    db.flush()
    return value


def _order(
    db: Session,
    account: PaperAccount,
    status: str = "planned",
    client_order_id: str = "client-1",
    *,
    side: str = "buy",
    quantity: Decimal = Decimal("10"),
    price: Decimal = Decimal("10"),
) -> PaperOrder:
    value = PaperOrder(
        account_id=account.id,
        client_order_id=client_order_id,
        symbol="600000.SH",
        exchange="SH",
        side=side,
        order_type="limit",
        quantity=quantity,
        price=price,
        status=status,
    )
    db.add(value)
    db.flush()
    return value


@pytest.mark.parametrize(
    ("source", "target"),
    [(source, target) for source, targets in ALLOWED_TRANSITIONS.items() for target in sorted(targets)],
)
def test_every_documented_order_transition_is_accepted(session_factory: sessionmaker[Session], source: str, target: str) -> None:
    db = session_factory()
    try:
        order = _order(db, _account(db), source, f"{source}-{target}")
        transition_order(order, target)
        assert order.status == target
    finally:
        db.close()


@pytest.mark.parametrize("source,target", [("planned", "filled"), ("unknown", "filled"), ("filled", "submitted"), ("cancelled", "cancel_pending")])
def test_illegal_order_transition_is_rejected(session_factory: sessionmaker[Session], source: str, target: str) -> None:
    db = session_factory()
    try:
        order = _order(db, _account(db), source, f"invalid-{source}-{target}")
        with pytest.raises(InvalidOrderTransition):
            transition_order(order, target)
    finally:
        db.close()


def test_fill_deduplication_and_weighted_average(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        order = _order(db, account, "submitted")
        first = apply_fill(db, order=order, broker_fill_id="fill-1", quantity=Decimal("4"), price=Decimal("10"))
        second = apply_fill(db, order=order, broker_fill_id="fill-2", quantity=Decimal("6"), price=Decimal("20"))
        replay = apply_fill(db, order=order, broker_fill_id="fill-2", quantity=Decimal("6"), price=Decimal("20"))
        assert replay.id == second.id
        assert first.id != second.id
        assert Decimal(str(order.filled_quantity)) == Decimal("10")
        assert Decimal(str(order.avg_fill_price)) == Decimal("16")
        assert order.status == "filled"
        assert db.scalar(select(PaperOrder).where(PaperOrder.client_order_id == "client-1")) is order
    finally:
        db.close()


def test_sell_fill_cannot_create_an_unapproved_negative_position(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        sell = _order(db, account, "submitted", "short-attempt", side="sell", quantity=Decimal("1"), price=Decimal("10"))
        with pytest.raises(ValueError, match="short position"):
            apply_fill(db, order=sell, broker_fill_id="short-attempt-fill", quantity=Decimal("1"), price=Decimal("10"))
    finally:
        db.close()


def test_fill_cash_rejection_happens_before_any_local_fill_or_order_change(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        buy = _order(db, account, "submitted", "cash-guard-buy", quantity=Decimal("1"), price=Decimal("10"))
        apply_fill(db, order=buy, broker_fill_id="cash-guard-buy-fill", quantity=Decimal("1"), price=Decimal("10"))
        account.cash = Decimal("0")
        db.flush()
        sell = _order(db, account, "submitted", "cash-guard-sell", side="sell", quantity=Decimal("1"), price=Decimal("10"))
        fill_count_before = len(db.scalars(select(PaperFill)).all())

        with pytest.raises(ValueError, match="cash negative"):
            apply_fill(
                db,
                order=sell,
                broker_fill_id="cash-guard-sell-fill",
                quantity=Decimal("1"),
                price=Decimal("10"),
                fee=Decimal("11"),
            )

        assert len(db.scalars(select(PaperFill)).all()) == fill_count_before
        assert sell.status == "submitted"
        assert Decimal(str(sell.filled_quantity)) == Decimal("0")
        assert Decimal(str(account.cash)) == Decimal("0")
    finally:
        db.close()


@pytest.mark.parametrize(
    "field,value",
    [
        ("order", "different-order"),
        ("symbol", "000001.SZ"),
        ("exchange", "SZ"),
        ("side", "sell"),
        ("quantity", Decimal("5")),
        ("price", Decimal("11")),
        ("fee", Decimal("1")),
    ],
)
def test_fill_replay_conflicts_on_any_persisted_fact(
    session_factory: sessionmaker[Session], field: str, value: object
) -> None:
    db = session_factory()
    try:
        account = _account(db)
        order = _order(db, account, "submitted")
        apply_fill(db, order=order, broker_fill_id="replay-fill", quantity=Decimal("4"), price=Decimal("10"))
        replay_order = order
        quantity = Decimal("4")
        price = Decimal("10")
        fee = Decimal("0")
        if field == "order":
            replay_order = _order(db, account, "submitted", str(value))
        elif field == "symbol":
            replay_order.symbol = str(value)
        elif field == "exchange":
            replay_order.exchange = str(value)
        elif field == "side":
            replay_order.side = str(value)
        elif field == "quantity":
            quantity = Decimal(str(value))
        elif field == "price":
            price = Decimal(str(value))
        else:
            fee = Decimal(str(value))
        with pytest.raises(ValueError, match="conflicts"):
            apply_fill(db, order=replay_order, broker_fill_id="replay-fill", quantity=quantity, price=price, fee=fee)
    finally:
        db.close()


def test_client_order_id_is_persistently_unique(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        _order(db, account, "planned", "duplicate-client")
        db.add(
            PaperOrder(
                account_id=account.id,
                client_order_id="duplicate-client",
                symbol="600000.SH",
                exchange="SH",
                side="buy",
                order_type="limit",
                quantity=Decimal("1"),
                price=Decimal("1"),
                status="planned",
            )
        )
        with pytest.raises(IntegrityError):
            db.flush()
    finally:
        db.rollback()
        db.close()


def test_paper_models_declare_database_safety_constraints() -> None:
    order_constraints = {constraint.name for constraint in PaperOrder.__table__.constraints}
    fill_constraints = {constraint.name for constraint in PaperFill.__table__.constraints}
    account_constraints = {constraint.name for constraint in PaperAccount.__table__.constraints}
    reconciliation_constraints = {constraint.name for constraint in ReconciliationRun.__table__.constraints}
    assert {
        "ck_paper_order_side",
        "ck_paper_order_quantity_positive",
        "ck_paper_order_price_nonnegative",
        "ck_paper_order_filled_quantity_nonnegative",
        "ck_paper_order_filled_quantity_lte_quantity",
        "ck_paper_order_status",
    }.issubset(order_constraints)
    assert {"ck_paper_fill_side", "ck_paper_fill_quantity_positive", "ck_paper_fill_price_nonnegative", "ck_paper_fill_fee_nonnegative"}.issubset(fill_constraints)
    assert {"ck_paper_account_status", "ck_paper_account_initial_capital_nonnegative", "ck_paper_account_cash_nonnegative"}.issubset(account_constraints)
    assert {
        "ck_reconciliation_run_status",
        "ck_reconciliation_run_result_status",
        "ck_reconciliation_run_checked_targets_nonnegative",
        "ck_reconciliation_run_differences_nonnegative",
    }.issubset(reconciliation_constraints)


def test_mock_is_deterministic_and_xtquant_is_controlled_unavailable() -> None:
    mock = build_adapter("mock")
    one = mock.submit_paper_order("same-client", {})
    two = mock.submit_paper_order("same-client", {})
    assert one.broker_order_id == two.broker_order_id
    assert one.status == "submitted"
    with pytest.raises(BrokerUnavailable):
        build_adapter("xtquant")


def test_reconciliation_records_filled_observation_without_overwriting_unknown(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        order = _order(db, account, "unknown")
        first = reconcile_orders(db, account_id=account.id, observations=[BrokerObservation(order.client_order_id, "unknown")])
        assert order.status == "unknown"
        assert first.discrepancies == []
        second = reconcile_orders(db, account_id=account.id, observations=[BrokerObservation(order.client_order_id, "filled", "mock-confirmed")])
        assert order.status == "unknown"
        assert order.broker_order_id is None
        assert db.scalars(select(PaperFill).where(PaperFill.order_id == order.id)).all() == []
        assert second.result_status == "difference"
        assert second.checked_targets_count == 1
        assert second.differences_count == 1
        assert second.discrepancies[0]["local_value"] == "unknown"
        assert second.discrepancies[0]["remote_value"] == "filled"
    finally:
        db.close()


@pytest.mark.parametrize(
    ("receipt_status", "expected_status", "expect_broker_id"),
    [
        ("submitted", "submitted", True),
        ("rejected", "rejected", True),
        ("filled", "unknown", False),
        ("partially_filled", "unknown", False),
        ("cancelled", "unknown", False),
    ],
)
def test_recovery_only_resolves_unknown_with_explicit_submission_or_rejection(
    session_factory: sessionmaker[Session], receipt_status: str, expected_status: str, expect_broker_id: bool
) -> None:
    db = session_factory()
    try:
        account = _account(db)
        order = _order(db, account, "unknown", f"recovery-{receipt_status}")
        PaperRecoveryService(db, _ReceiptAdapter(receipt_status)).recover_order(order)
        assert order.status == expected_status
        assert (order.broker_order_id == "receipt-order") is expect_broker_id
        run = db.scalars(select(ReconciliationRun)).one()
        assert run.result_status == "difference"
        assert run.discrepancies[0]["remote_value"] == receipt_status
        assert db.scalars(select(PaperFill).where(PaperFill.order_id == order.id)).all() == []
    finally:
        db.close()


# 30 explicit G6 configuration/edge boundaries: valid low/high edges and
# rejected values across all five configurable limits.
@pytest.mark.parametrize(
    "field,value,valid",
    [
        ("max_position_per_symbol", "0", True), ("max_position_per_symbol", "1", True), ("max_position_per_symbol", "-0.01", False), ("max_position_per_symbol", "1.01", False), ("max_position_per_symbol", "0.25", True), ("max_position_per_symbol", "0.25000001", True),
        ("max_total_position", "0", True), ("max_total_position", "1", True), ("max_total_position", "-0.01", False), ("max_total_position", "1.01", False), ("max_total_position", "0.95", True), ("max_total_position", "0.95000001", True),
        ("max_daily_loss_pct", "0", True), ("max_daily_loss_pct", "1", True), ("max_daily_loss_pct", "-0.01", False), ("max_daily_loss_pct", "1.01", False), ("max_daily_loss_pct", "0.05", True), ("max_daily_loss_pct", "0.05000001", True),
        ("max_order_value_pct", "0", True), ("max_order_value_pct", "1", True), ("max_order_value_pct", "-0.01", False), ("max_order_value_pct", "1.01", False), ("max_order_value_pct", "0.10", True), ("max_order_value_pct", "0.10000001", True),
        ("max_daily_turnover_pct", "0", True), ("max_daily_turnover_pct", "10", True), ("max_daily_turnover_pct", "-0.01", False), ("max_daily_turnover_pct", "10.01", False), ("max_daily_turnover_pct", "5", True), ("max_daily_turnover_pct", "5.00000001", True),
    ],
)
def test_safety_limit_configuration_boundaries(field: str, value: str, valid: bool) -> None:
    kwargs = {field: Decimal(value)}
    if valid:
        assert getattr(SafetyLimits(**kwargs), field) == Decimal(value)
    else:
        with pytest.raises(SafetyViolation):
            SafetyLimits(**kwargs)


def test_pre_trade_unknown_kill_loss_and_sell_exemption(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        unknown = _order(db, account, "unknown")
        with pytest.raises(UncertainOrderState):
            pre_trade_check(account=account, symbol="600000.SH", side="buy", quantity=Decimal("1"), price=Decimal("1"), db=db)
        unknown.status = "rejected"
        db.flush()
        with pytest.raises(SafetyViolation):
            pre_trade_check(account=account, symbol="600000.SH", side="buy", quantity=Decimal("11"), price=Decimal("10"), db=db)
        with pytest.raises(SafetyViolation):
            pre_trade_check(account=account, symbol="600000.SH", side="buy", quantity=Decimal("1"), price=Decimal("1"), positions={"600000.SH": Decimal("250")}, db=db)
        pre_trade_check(account=account, symbol="600000.SH", side="sell", quantity=Decimal("10"), price=Decimal("10"), positions={"600000.SH": Decimal("1000")}, position_quantities={"600000.SH": Decimal("10")}, total_position_value=Decimal("1000"), db=db)
        switch = KillSwitch(db)
        tracker = DailyLossTracker(initial_capital=Decimal("1000"), kill_switch=switch)
        assert tracker.record(Decimal("-49")) == Decimal("-49")
        tracker.record(Decimal("-1"))
        with pytest.raises(TradingHalted):
            switch.check()
        with pytest.raises(TradingHalted):
            pre_trade_check(account=account, symbol="600000.SH", side="sell", quantity=Decimal("1"), price=Decimal("1"), kill_switch=switch, db=db)
        with pytest.raises(UncertainOrderState):
            unknown.status = "unknown"
            db.flush()
            check_uncertain_state(db, account.id)
    finally:
        db.close()


def test_sell_is_only_risk_reducing_when_the_position_covers_it(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        base = {
            "account": account,
            "symbol": "600000.SH",
            "side": "sell",
            "quantity": Decimal("10"),
            "price": Decimal("10"),
        }
        with pytest.raises(SafetyViolation, match="short selling"):
            pre_trade_check(**base, positions={}, position_quantities={})
        with pytest.raises(SafetyViolation, match="short selling"):
            pre_trade_check(**base, positions={"600000.SH": Decimal("100")}, position_quantities={"600000.SH": Decimal("9")})
        pre_trade_check(**base, positions={"600000.SH": Decimal("100")}, position_quantities={"600000.SH": Decimal("10")})
        pre_trade_check(**(base | {"quantity": Decimal("5")}), positions={"600000.SH": Decimal("100")}, position_quantities={"600000.SH": Decimal("10")})
    finally:
        db.close()


def test_profitable_sell_is_allowed_by_quantity_coverage_only(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        limits = SafetyLimits(max_order_value_pct=Decimal("1"))
        base = {
            "account": account,
            "symbol": "600000.SH",
            "side": "sell",
            "price": Decimal("20"),
            "limits": limits,
            # The cost-basis value is only 10, but the held quantity is 10.
            "positions": {"600000.SH": Decimal("10")},
            "position_quantities": {"600000.SH": Decimal("10")},
        }
        pre_trade_check(**(base | {"quantity": Decimal("10")}))
        with pytest.raises(SafetyViolation, match="short selling"):
            pre_trade_check(**(base | {"quantity": Decimal("11")}))
    finally:
        db.close()


def test_kill_switch_recovery_is_admin_only_and_audited(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        switch = KillSwitch(db)
        switch.trigger("manual test", "operator")
        with pytest.raises(PermissionError):
            switch.recover("not allowed", actor=Actor("auditor", "auditor", ("audit:read",)))
        switch.trigger("later ignored", "other")
        switch.recover("verified", actor=Actor("admin", "admin", ("admin",)))
        switch.check()
        state = db.get(SafetyState, "paper-trading")
        assert state is not None
        assert state.reason is None
        assert state.triggered_by is None
        assert state.triggered_at is None
        switch.recover("idempotent", actor=Actor("admin", "admin", ("admin",)))
        actions = db.scalars(select(AuditEvent.action).order_by(AuditEvent.created_at)).all()
        assert actions == [
            "paper.kill_switch.trigger",
            "paper.kill_switch.trigger",
            "paper.kill_switch.recover",
            "paper.kill_switch.recover",
        ]
    finally:
        db.close()


def test_daily_report_uses_time_ordered_cost_basis_and_target_day_only(session_factory: sessionmaker[Session]) -> None:
    db = session_factory()
    try:
        account = _account(db)
        day_one = datetime(2024, 1, 1, 9, tzinfo=timezone.utc)
        day_two = datetime(2024, 1, 2, 9, tzinfo=timezone.utc)
        day_three = datetime(2024, 1, 3, 9, tzinfo=timezone.utc)
        buy = _order(db, account, "submitted", "daily-buy", quantity=Decimal("10"), price=Decimal("10"))
        apply_fill(db, order=buy, broker_fill_id="daily-buy-fill", quantity=Decimal("10"), price=Decimal("10"), fee=Decimal("1"), fill_timestamp=day_one)
        partial_sell = _order(db, account, "submitted", "daily-sell-partial", side="sell", quantity=Decimal("4"), price=Decimal("15"))
        apply_fill(db, order=partial_sell, broker_fill_id="daily-sell-partial-fill", quantity=Decimal("4"), price=Decimal("15"), fee=Decimal("1"), fill_timestamp=day_two)
        after_partial = paper_positions(db, account.id)
        assert after_partial == [{"symbol": "600000.SH", "exchange": "SH", "quantity": "6.00000000", "avg_price": "10.00000000"}]
        day_two_report = daily_report(db, account, date(2024, 1, 2))
        assert isinstance(day_two_report["day_pnl"], str)
        assert isinstance(day_two_report["total_fees"], str)
        assert isinstance(day_two_report["trades"][0]["price"], str)
        assert Decimal(str(day_two_report["day_pnl"])) == Decimal("19.0")
        assert Decimal(str(day_two_report["total_fees"])) == Decimal("1.0")
        assert Decimal(str(day_two_report["turnover"])) == Decimal("6")
        assert day_two_report["filled_orders_count"] == 1
        assert Decimal(str(daily_report(db, account, date(2024, 1, 1))["day_pnl"])) == Decimal("-1.0")
        close = _order(db, account, "submitted", "daily-sell-close", side="sell", quantity=Decimal("6"), price=Decimal("12"))
        apply_fill(db, order=close, broker_fill_id="daily-sell-close-fill", quantity=Decimal("6"), price=Decimal("12"), fee=Decimal("1"), fill_timestamp=day_three)
        assert paper_positions(db, account.id) == []
        day_three_report = daily_report(db, account, date(2024, 1, 3))
        assert Decimal(str(day_three_report["day_pnl"])) == Decimal("11.0")
        assert day_three_report["filled_orders_count"] == 1
    finally:
        db.close()
