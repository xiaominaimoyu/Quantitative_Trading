"""Paper-order reconciliation: record observations without changing facts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from quant_trading.models.recovery import PaperOrder, ReconciliationRun, utcnow
from quant_trading.services.recovery import append_audit


@dataclass(frozen=True, slots=True)
class BrokerObservation:
    client_order_id: str
    status: str
    broker_order_id: str | None = None


def reconcile_orders(
    db: Session,
    *,
    account_id: str,
    observations: Iterable[BrokerObservation],
    actor_key: str = "system",
    request_id: str | None = None,
) -> ReconciliationRun:
    """Create an append-only reconciliation observation record.

    Reconciliation intentionally does not update an order, broker identifier,
    fill, or account cash.  Recovery has a separate, narrow authority to
    advance an UNKNOWN order only when a submitted/rejected broker receipt is
    explicit.  Filled/cancelled observations without durable local facts stay
    discrepancies rather than becoming reconstructed transactions.
    """

    observed_values = list(observations)
    discrepancies: list[dict[str, object]] = []
    for observation in observed_values:
        order = db.scalar(
            select(PaperOrder).where(
                PaperOrder.account_id == account_id,
                PaperOrder.client_order_id == observation.client_order_id,
            )
        )
        if order is None:
            discrepancies.append(
                {
                    "target": f"order:{observation.client_order_id}",
                    "type": "difference",
                    "local_value": None,
                    "remote_value": observation.status,
                    "difference": "remote order has no local fact",
                    "summary": "Remote observation was not applied",
                    "checked_at": utcnow().isoformat(),
                }
            )
            continue
        local_status = order.status
        if local_status == observation.status:
            continue
        discrepancies.append(
            {
                "target": f"order:{order.client_order_id}",
                "type": "difference",
                "local_value": local_status,
                "remote_value": observation.status,
                "difference": "state mismatch",
                "summary": "Preserved local fact pending explicit recovery or durable fill/cancel evidence",
                "checked_at": utcnow().isoformat(),
            }
        )
    run = ReconciliationRun(
        account_id=account_id,
        status="completed",
        result_status="difference" if discrepancies else "matched",
        discrepancies=discrepancies,
        checked_targets_count=len(observed_values),
        differences_count=len(discrepancies),
        completed_at=utcnow(),
    )
    db.add(run)
    db.flush()
    append_audit(
        db,
        actor_key=actor_key,
        action="paper.reconcile",
        target="paper_account",
        business_id=account_id,
        request_id=request_id,
        after={
            "run_id": run.id,
            "checked_targets_count": run.checked_targets_count,
            "differences_count": run.differences_count,
        },
    )
    return run
