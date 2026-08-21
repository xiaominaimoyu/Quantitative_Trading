"""Paper-order state machine and exact-once fill accounting."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum

from sqlalchemy import select
from sqlalchemy.orm import Session

from quant_trading.models.recovery import PaperAccount, PaperFill, PaperOrder, utcnow


class OrderStatus(str, Enum):
    PLANNED = "planned"
    BLOCKED = "blocked"
    SUBMITTING = "submitting"
    SUBMITTED = "submitted"
    UNKNOWN = "unknown"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCEL_PENDING = "cancel_pending"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


TERMINAL_ORDER_STATUSES = {
    OrderStatus.BLOCKED.value,
    OrderStatus.REJECTED.value,
    OrderStatus.FILLED.value,
    OrderStatus.CANCELLED.value,
}

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    OrderStatus.PLANNED.value: {OrderStatus.BLOCKED.value, OrderStatus.SUBMITTING.value},
    OrderStatus.SUBMITTING.value: {OrderStatus.SUBMITTED.value, OrderStatus.UNKNOWN.value},
    OrderStatus.UNKNOWN.value: {OrderStatus.SUBMITTED.value, OrderStatus.REJECTED.value},
    OrderStatus.SUBMITTED.value: {
        OrderStatus.PARTIALLY_FILLED.value,
        OrderStatus.FILLED.value,
        OrderStatus.CANCEL_PENDING.value,
        OrderStatus.REJECTED.value,
    },
    OrderStatus.PARTIALLY_FILLED.value: {OrderStatus.FILLED.value, OrderStatus.CANCEL_PENDING.value},
    OrderStatus.CANCEL_PENDING.value: {OrderStatus.CANCELLED.value, OrderStatus.FILLED.value},
    OrderStatus.BLOCKED.value: set(),
    OrderStatus.REJECTED.value: set(),
    OrderStatus.FILLED.value: set(),
    OrderStatus.CANCELLED.value: set(),
}


class InvalidOrderTransition(ValueError):
    pass


def held_quantity(db: Session, *, account_id: str, symbol: str, exchange: str) -> Decimal:
    """Return settled local paper quantity without marking it to market."""

    fills = db.scalars(
        select(PaperFill)
        .join(PaperOrder, PaperFill.order_id == PaperOrder.id)
        .where(
            PaperOrder.account_id == account_id,
            PaperFill.symbol == symbol,
            PaperFill.exchange == exchange,
        )
    ).all()
    quantity = Decimal("0")
    for fill in fills:
        fill_quantity = Decimal(str(fill.quantity))
        quantity += fill_quantity if fill.side == "buy" else -fill_quantity
    return quantity


def transition_order(
    order: PaperOrder,
    new_status: OrderStatus | str,
    *,
    error_code: str | None = None,
    error_message: str | None = None,
    now: datetime | None = None,
) -> PaperOrder:
    """Apply one and only one documented state transition."""

    target = new_status.value if isinstance(new_status, OrderStatus) else str(new_status)
    current = str(order.status)
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise InvalidOrderTransition(f"Illegal paper-order transition: {current} -> {target}")
    timestamp = now or utcnow()
    order.status = target
    order.error_code = error_code
    order.error_message = error_message
    if target == OrderStatus.SUBMITTED.value and order.submitted_at is None:
        order.submitted_at = timestamp
    if target in TERMINAL_ORDER_STATUSES:
        order.completed_at = timestamp
    order.updated_at = timestamp
    return order


def apply_fill(
    db: Session,
    *,
    order: PaperOrder,
    broker_fill_id: str,
    quantity: Decimal,
    price: Decimal,
    fee: Decimal = Decimal("0"),
    fill_timestamp: datetime | None = None,
) -> PaperFill:
    """Persist a unique fill and update the order's weighted average exactly once."""

    if quantity <= 0 or price < 0 or fee < 0:
        raise ValueError("fill quantity must be positive and price/fee must not be negative")
    existing = db.scalar(select(PaperFill).where(PaperFill.broker_fill_id == broker_fill_id))
    if existing is not None:
        expected = {
            "order_id": order.id,
            "symbol": order.symbol,
            "exchange": order.exchange,
            "side": order.side,
            "quantity": quantity,
            "price": price,
            "fee": fee,
        }
        actual = {
            "order_id": existing.order_id,
            "symbol": existing.symbol,
            "exchange": existing.exchange,
            "side": existing.side,
            "quantity": Decimal(str(existing.quantity)),
            "price": Decimal(str(existing.price)),
            "fee": Decimal(str(existing.fee)),
        }
        if actual != expected:
            raise ValueError("broker_fill_id replay conflicts with the persisted fill")
        return existing
    if order.status not in {OrderStatus.SUBMITTED.value, OrderStatus.PARTIALLY_FILLED.value}:
        raise InvalidOrderTransition(f"Cannot apply a fill while order is {order.status}")
    previous_quantity = Decimal(str(order.filled_quantity))
    total_quantity = previous_quantity + quantity
    requested_quantity = Decimal(str(order.quantity))
    if total_quantity > requested_quantity:
        raise ValueError("fill would exceed requested order quantity")
    if order.side == "sell":
        available = held_quantity(
            db,
            account_id=order.account_id,
            symbol=order.symbol,
            exchange=order.exchange,
        )
        if quantity > available:
            raise ValueError("paper sell fill would create a short position")
    account = db.get(PaperAccount, order.account_id)
    value = quantity * price
    if account is not None:
        cash = Decimal(str(account.cash))
        post_fill_cash = cash - value - fee if order.side == "buy" else cash + value - fee
        # This check must precede creating a PaperFill or changing the order,
        # so an accounting rejection cannot leave a partial local fact.
        if post_fill_cash < 0:
            raise ValueError("paper fill would make cash negative")
    previous_average = Decimal(str(order.avg_fill_price or 0))
    average = ((previous_quantity * previous_average) + (quantity * price)) / total_quantity
    fill = PaperFill(
        order_id=order.id,
        broker_fill_id=broker_fill_id,
        symbol=order.symbol,
        exchange=order.exchange,
        side=order.side,
        quantity=quantity,
        price=price,
        fee=fee,
        fill_timestamp=fill_timestamp or utcnow(),
    )
    db.add(fill)
    order.filled_quantity = total_quantity
    order.avg_fill_price = average
    if account is not None:
        account.cash = post_fill_cash
    timestamp = fill_timestamp or utcnow()
    transition_order(
        order,
        OrderStatus.FILLED if total_quantity == requested_quantity else OrderStatus.PARTIALLY_FILLED,
        now=timestamp,
    )
    db.flush()
    return fill
