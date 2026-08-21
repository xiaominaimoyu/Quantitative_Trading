"""Deterministic daily aggregates from persisted paper facts only."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from quant_trading.models.recovery import PaperAccount, PaperFill, PaperOrder


def _decimal_text(value: Decimal) -> str:
    """Encode financial facts as fixed-point JSON strings, never floats."""

    return format(value, "f")


def _ordered_fills(db: Session, account_id: str) -> list[PaperFill]:
    """Read fills in their durable event order, never from a broker feed."""

    return db.scalars(
        select(PaperFill)
        .join(PaperOrder, PaperFill.order_id == PaperOrder.id)
        .where(PaperOrder.account_id == account_id)
        .order_by(PaperFill.fill_timestamp, PaperFill.id)
    ).all()


def _inventory_apply(
    inventory: dict[tuple[str, str], dict[str, Decimal]],
    fill: PaperFill,
) -> Decimal:
    """Apply a fill and return realized P&L before the fill fee.

    Average acquisition cost is retained after a partial sale.  A negative
    local holding is rejected rather than silently represented as a position.
    """

    key = (fill.symbol, fill.exchange)
    state = inventory.setdefault(key, {"quantity": Decimal("0"), "cost": Decimal("0")})
    quantity = Decimal(str(fill.quantity))
    price = Decimal(str(fill.price))
    if fill.side == "buy":
        state["quantity"] += quantity
        state["cost"] += quantity * price
        return Decimal("0")

    held = state["quantity"]
    if quantity > held:
        raise ValueError("persisted paper fills would create a short position")
    average_cost = state["cost"] / held if held else Decimal("0")
    realized = (price - average_cost) * quantity
    state["quantity"] = held - quantity
    state["cost"] -= average_cost * quantity
    if state["quantity"] == 0:
        state["cost"] = Decimal("0")
    return realized


def _inventory_for_fills(fills: list[PaperFill]) -> dict[tuple[str, str], dict[str, Decimal]]:
    inventory: dict[tuple[str, str], dict[str, Decimal]] = {}
    for fill in fills:
        _inventory_apply(inventory, fill)
    return inventory


def paper_positions(db: Session, account_id: str) -> list[dict[str, object]]:
    inventory = _inventory_for_fills(_ordered_fills(db, account_id))
    output: list[dict[str, object]] = []
    for (symbol, exchange), state in sorted(inventory.items()):
        quantity = state["quantity"]
        if quantity <= 0:
            continue
        average_cost = state["cost"] / quantity
        output.append(
            {
                "symbol": symbol,
                "exchange": exchange,
                "quantity": _decimal_text(quantity),
                "avg_price": _decimal_text(average_cost),
            }
        )
    return output


def daily_report(db: Session, account: PaperAccount, report_date: date) -> dict[str, object]:
    """Aggregate only the requested day's fills while preserving prior basis."""

    orders = db.scalars(select(PaperOrder).where(PaperOrder.account_id == account.id)).all()
    fills = _ordered_fills(db, account.id)
    inventory: dict[tuple[str, str], dict[str, Decimal]] = {}
    realized_pnl = Decimal("0")
    fees = Decimal("0")
    turnover_value = Decimal("0")
    trades: list[dict[str, object]] = []

    for fill in fills:
        fill_day = fill.fill_timestamp.date()
        realized_before_fee = _inventory_apply(inventory, fill)
        if fill_day != report_date:
            continue
        quantity = Decimal(str(fill.quantity))
        price = Decimal(str(fill.price))
        fee = Decimal(str(fill.fee))
        realized_pnl += realized_before_fee
        fees += fee
        turnover_value += quantity * price
        trades.append(
            {
                "order_id": fill.order_id,
                "broker_fill_id": fill.broker_fill_id,
                "symbol": fill.symbol,
                "exchange": fill.exchange,
                "side": fill.side,
                "quantity": _decimal_text(quantity),
                "price": _decimal_text(price),
                "fee": _decimal_text(fee),
                "realized_pnl_before_fee": _decimal_text(realized_before_fee),
                "fill_timestamp": fill.fill_timestamp.isoformat(),
            }
        )

    unknown_count = sum(order.status == "unknown" for order in orders)
    filled_count = sum(
        order.status == "filled"
        and order.completed_at is not None
        and order.completed_at.date() == report_date
        for order in orders
    )
    capital = Decimal(str(account.initial_capital))
    day_pnl = realized_pnl - fees
    return {
        "account_id": account.id,
        "date": report_date.isoformat(),
        "trades": trades,
        "risk": {"mode": "paper_only"},
        "exceptions": ["unknown order requires reconciliation"] if unknown_count else [],
        "reconciliation": {"unknown_orders_count": unknown_count},
        "day_pnl": _decimal_text(day_pnl),
        "day_pnl_pct": _decimal_text((day_pnl / capital) * Decimal("100")) if capital > 0 else "0",
        # UI values are percentage points, consistent with day_pnl_pct.
        "turnover": _decimal_text((turnover_value / capital) * Decimal("100")) if capital > 0 else "0",
        "total_fees": _decimal_text(fees),
        "filled_orders_count": filled_count,
        "unknown_orders_count": unknown_count,
        "notes": "Local deterministic paper-trading aggregate; no broker connection.",
    }
