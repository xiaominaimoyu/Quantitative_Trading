"""Controlled paper-order recovery after connection uncertainty."""

from __future__ import annotations

from sqlalchemy.orm import Session

from quant_trading.execution.adapter import BrokerAdapter
from quant_trading.execution.orders import OrderStatus, transition_order
from quant_trading.execution.reconciliation import BrokerObservation, reconcile_orders
from quant_trading.models.recovery import PaperOrder


class PaperRecoveryService:
    """Marks only an in-flight submission uncertain and requires explicit query confirmation."""

    def __init__(self, db: Session, adapter: BrokerAdapter):
        self.db = db
        self.adapter = adapter

    def on_disconnect(self, order: PaperOrder) -> PaperOrder:
        if order.status == OrderStatus.SUBMITTING.value:
            transition_order(order, OrderStatus.UNKNOWN, error_code="BROKER_TIMEOUT", error_message="Paper broker acknowledgement was interrupted")
        return order

    def recover_order(self, order: PaperOrder, *, actor_key: str = "system") -> PaperOrder:
        if order.status != OrderStatus.UNKNOWN.value:
            return order
        receipt = self.adapter.query_paper_order(order.broker_order_id, order.client_order_id)
        # Persist the remote observation first.  Reconciliation itself never
        # rewrites a local fact, including UNKNOWN.
        reconcile_orders(
            self.db,
            account_id=order.account_id,
            observations=[BrokerObservation(order.client_order_id, receipt.status, receipt.broker_order_id)],
            actor_key=actor_key,
        )
        # The recovery service is deliberately narrower than reconciliation:
        # an explicit acknowledgement/rejection may resolve a lost submission,
        # but a claimed fill/partial/cancel has no durable fill/cancel fact and
        # therefore remains UNKNOWN.
        if receipt.status == OrderStatus.SUBMITTED.value:
            transition_order(order, OrderStatus.SUBMITTED)
            if receipt.broker_order_id:
                order.broker_order_id = receipt.broker_order_id
        elif receipt.status == OrderStatus.REJECTED.value:
            transition_order(order, OrderStatus.REJECTED)
            if receipt.broker_order_id:
                order.broker_order_id = receipt.broker_order_id
        return order
