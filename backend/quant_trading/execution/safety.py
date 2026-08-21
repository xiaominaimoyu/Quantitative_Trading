"""G6 safety guards for local paper trading only.

The module intentionally contains no real-broker controls.  Its state is
scoped to a persisted paper-trading safety record (or a short-lived test
instance), and every persisted transition appends an audit event.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from quant_trading.core.auth import Actor
from quant_trading.execution.report import paper_positions
from quant_trading.models.recovery import PaperAccount, PaperOrder, SafetyState, utcnow
from quant_trading.services.recovery import append_audit


class TradingHalted(RuntimeError):
    pass


class SafetyViolation(ValueError):
    pass


class UncertainOrderState(SafetyViolation):
    pass


def as_decimal(value: object, field: str) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise SafetyViolation(f"{field} must be a decimal value") from None
    if not result.is_finite():
        raise SafetyViolation(f"{field} must be finite")
    return result


@dataclass(frozen=True, slots=True)
class SafetyLimits:
    """Paper-trading caps represented as decimal ratios, not binary floats."""

    max_position_per_symbol: Decimal = Decimal("0.25")
    max_total_position: Decimal = Decimal("0.95")
    max_daily_loss_pct: Decimal = Decimal("0.05")
    max_daily_turnover_pct: Decimal = Decimal("5.00")
    max_order_value_pct: Decimal = Decimal("0.10")

    def __post_init__(self) -> None:
        bounded = {
            "max_position_per_symbol": self.max_position_per_symbol,
            "max_total_position": self.max_total_position,
            "max_daily_loss_pct": self.max_daily_loss_pct,
            "max_order_value_pct": self.max_order_value_pct,
        }
        for name, value in bounded.items():
            decimal_value = as_decimal(value, name)
            if decimal_value < 0 or decimal_value > 1:
                raise SafetyViolation(f"{name} must be between 0 and 1")
            object.__setattr__(self, name, decimal_value)
        turnover = as_decimal(self.max_daily_turnover_pct, "max_daily_turnover_pct")
        if turnover < 0 or turnover > Decimal("10"):
            raise SafetyViolation("max_daily_turnover_pct must be between 0 and 10")
        object.__setattr__(self, "max_daily_turnover_pct", turnover)

    @property
    def max_single_symbol_pct(self) -> Decimal:
        return self.max_position_per_symbol

    @property
    def max_single_order_pct(self) -> Decimal:
        return self.max_order_value_pct


class KillSwitch:
    """Paper-only kill switch with append-only persisted audit evidence."""

    def __init__(self, db: Session | None = None, *, scope: str = "paper-trading"):
        self.db = db
        self.scope = scope
        self._test_triggered = False
        self._test_reason: str | None = None

    def _state(self) -> SafetyState | None:
        if self.db is None:
            return None
        state = self.db.get(SafetyState, self.scope)
        if state is None:
            state = SafetyState(scope=self.scope)
            self.db.add(state)
            self.db.flush()
        return state

    def trigger(self, reason: str, triggered_by: str | Actor = "system") -> None:
        if not reason or not reason.strip():
            raise SafetyViolation("kill switch reason is required")
        actor_key = triggered_by.key if isinstance(triggered_by, Actor) else str(triggered_by)
        state = self._state()
        if state is None:
            # Repeated triggers are idempotent in the in-memory test form: the
            # first trigger remains the authoritative current halt reason.
            if self._test_triggered:
                return
            self._test_triggered = True
            self._test_reason = reason.strip()
            return
        before = {"is_triggered": state.is_triggered, "reason": state.reason}
        if state.is_triggered:
            append_audit(
                self.db,
                actor_key=actor_key,
                action="paper.kill_switch.trigger",
                target="paper_safety",
                business_id=self.scope,
                reason=reason.strip(),
                before=before,
                after={"is_triggered": True, "reason": state.reason, "outcome": "already_triggered"},
            )
            return
        state.is_triggered = True
        state.reason = reason.strip()
        state.triggered_by = actor_key
        state.triggered_at = utcnow()
        append_audit(
            self.db,
            actor_key=actor_key,
            action="paper.kill_switch.trigger",
            target="paper_safety",
            business_id=self.scope,
            reason=reason.strip(),
            before=before,
            after={"is_triggered": True, "reason": state.reason},
        )

    def recover(self, reason: str, *, actor: Actor) -> None:
        if actor.role != "admin":
            raise PermissionError("Kill switch recovery requires an administrator")
        if not reason or not reason.strip():
            raise SafetyViolation("kill switch recovery reason is required")
        state = self._state()
        if state is None:
            self._test_triggered = False
            self._test_reason = None
            return
        before = {"is_triggered": state.is_triggered, "reason": state.reason}
        if not state.is_triggered:
            append_audit(
                self.db,
                actor_key=actor.key,
                action="paper.kill_switch.recover",
                target="paper_safety",
                business_id=self.scope,
                reason=reason.strip(),
                before=before,
                after={"is_triggered": False, "reason": None, "outcome": "already_recovered"},
            )
            return
        state.is_triggered = False
        state.reason = None
        state.triggered_by = None
        state.triggered_at = None
        state.recovered_by = actor.key
        state.recovered_at = utcnow()
        append_audit(
            self.db,
            actor_key=actor.key,
            action="paper.kill_switch.recover",
            target="paper_safety",
            business_id=self.scope,
            reason=reason.strip(),
            before=before,
            after={"is_triggered": False, "reason": None},
        )

    def check(self) -> None:
        state = self._state()
        if state is None:
            if self._test_triggered:
                raise TradingHalted(self._test_reason or "Paper trading is halted")
            return
        if state.is_triggered:
            raise TradingHalted(state.reason or "Paper trading is halted")


def check_uncertain_state(db: Session, account_id: str) -> None:
    uncertain = db.scalar(
        select(PaperOrder.id).where(
            PaperOrder.account_id == account_id,
            PaperOrder.status == "unknown",
        ).limit(1)
    )
    if uncertain is not None:
        raise UncertainOrderState("New paper orders are blocked until unknown orders are reconciled")


def _current_position_values(db: Session | None, account_id: str | None) -> Mapping[str, Decimal]:
    """Use persisted paper inventory cost as a conservative local value."""

    if db is None or account_id is None:
        return {}
    return {
        str(position["symbol"]): Decimal(str(position["quantity"])) * Decimal(str(position["avg_price"]))
        for position in paper_positions(db, account_id)
    }


def _current_position_quantities(db: Session | None, account_id: str | None) -> Mapping[str, Decimal]:
    if db is None or account_id is None:
        return {}
    return {str(position["symbol"]): Decimal(str(position["quantity"])) for position in paper_positions(db, account_id)}


def pre_trade_check(
    *,
    account: PaperAccount,
    symbol: str,
    side: str,
    quantity: Decimal | str | int | float,
    price: Decimal | str | int | float,
    limits: SafetyLimits | None = None,
    kill_switch: KillSwitch | None = None,
    db: Session | None = None,
    positions: Mapping[str, Decimal | str | int | float] | None = None,
    position_quantities: Mapping[str, Decimal | str | int | float] | None = None,
    total_position_value: Decimal | str | int | float | None = None,
    realized_pnl: Decimal | str | int | float = Decimal("0"),
    daily_turnover: Decimal | str | int | float = Decimal("0"),
) -> None:
    """Evaluate the six G6 controls before a simulated order is accepted.

    A sell is treated as risk-reducing for the two position checks only; it
    still must pass kill-switch, uncertain-state, per-order, loss and turnover
    controls.
    """

    active_limits = limits or SafetyLimits()
    if side not in {"buy", "sell"}:
        raise SafetyViolation("side must be buy or sell")
    amount = as_decimal(quantity, "quantity") * as_decimal(price, "price")
    if as_decimal(quantity, "quantity") <= 0 or as_decimal(price, "price") < 0:
        raise SafetyViolation("quantity must be positive and price must not be negative")
    equity = as_decimal(account.initial_capital, "initial_capital")
    if equity <= 0:
        raise SafetyViolation("initial_capital must be positive for safety checks")
    active_switch = kill_switch or KillSwitch(db)
    active_switch.check()
    if db is not None:
        check_uncertain_state(db, account.id)
    if amount > equity * active_limits.max_order_value_pct:
        raise SafetyViolation("single paper order exceeds the configured limit")

    pnl = as_decimal(realized_pnl, "realized_pnl")
    if pnl <= -(equity * active_limits.max_daily_loss_pct):
        active_switch.trigger("daily realized loss limit reached", "risk-guard")
        raise TradingHalted("daily realized loss limit reached")
    turnover = as_decimal(daily_turnover, "daily_turnover")
    if turnover + amount > equity * active_limits.max_daily_turnover_pct:
        raise SafetyViolation("daily paper-trading turnover exceeds the configured limit")

    values = {key: as_decimal(value, f"position[{key}]") for key, value in (positions or _current_position_values(db, account.id)).items()}
    quantities = {
        key: as_decimal(value, f"position_quantity[{key}]")
        for key, value in (position_quantities or _current_position_quantities(db, account.id)).items()
    }
    if side == "sell":
        # A sell is risk-reducing only when a persisted/current holding fully
        # covers its *quantity*.  Acquisition cost is not a limit on a sale:
        # a profitable exit may legitimately have a greater notional value
        # than the position's cost basis.  This paper simulator does not
        # authorize short selling.
        if quantities.get(symbol, Decimal("0")) < as_decimal(quantity, "quantity"):
            raise SafetyViolation("paper sell order exceeds the current position; short selling is not allowed")
        return
    symbol_value = values.get(symbol, Decimal("0")) + amount
    aggregate_value = as_decimal(total_position_value, "total_position_value") if total_position_value is not None else sum(values.values(), Decimal("0"))
    if symbol_value > equity * active_limits.max_position_per_symbol:
        raise SafetyViolation("single-symbol paper position exceeds the configured limit")
    if aggregate_value + amount > equity * active_limits.max_total_position:
        raise SafetyViolation("total paper position exceeds the configured limit")


class DailyLossTracker:
    """Request/service-scoped realized P&L tracker with automatic paper halt."""

    def __init__(
        self,
        *,
        initial_capital: Decimal | str | int | float,
        limits: SafetyLimits | None = None,
        kill_switch: KillSwitch | None = None,
    ):
        self.initial_capital = as_decimal(initial_capital, "initial_capital")
        if self.initial_capital <= 0:
            raise SafetyViolation("initial_capital must be positive")
        self.limits = limits or SafetyLimits()
        self.kill_switch = kill_switch or KillSwitch()
        self.realized_pnl = Decimal("0")

    def record(self, pnl: Decimal | str | int | float, *, actor_key: str = "risk-guard") -> Decimal:
        self.realized_pnl += as_decimal(pnl, "realized_pnl")
        if self.realized_pnl <= -(self.initial_capital * self.limits.max_daily_loss_pct):
            self.kill_switch.trigger("daily realized loss limit reached", actor_key)
        return self.realized_pnl
