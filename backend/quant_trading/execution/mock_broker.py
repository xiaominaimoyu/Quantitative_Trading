"""Deterministic, dependency-free broker substitute for simulation only."""

from __future__ import annotations

import hashlib

from quant_trading.execution.adapter import BrokerOrderReceipt, register_adapter


class MockBrokerAdapter:
    name = "mock"

    def availability(self) -> tuple[bool, str | None]:
        return True, None

    @staticmethod
    def _broker_id(client_order_id: str) -> str:
        digest = hashlib.sha256(client_order_id.encode("utf-8")).hexdigest()[:16]
        return f"MOCK-{digest}"

    def submit_paper_order(self, client_order_id: str, payload: dict[str, object]) -> BrokerOrderReceipt:
        # The adapter is deterministic and intentionally only acknowledges a
        # simulated order.  Filling remains an explicit local test/service act.
        return BrokerOrderReceipt(client_order_id, self._broker_id(client_order_id), "submitted")

    def query_paper_order(self, broker_order_id: str | None, client_order_id: str) -> BrokerOrderReceipt:
        return BrokerOrderReceipt(client_order_id, broker_order_id or self._broker_id(client_order_id), "submitted")


class XtQuantUnavailableAdapter:
    """A safe, non-operational placeholder for the optional xtquant SDK."""

    name = "xtquant"

    def availability(self) -> tuple[bool, str | None]:
        try:
            __import__("xtquant")
        except ImportError:
            return False, "xtquant SDK is not installed; real broker actions are unavailable"
        return False, "xtquant integration is intentionally disabled in recovered paper-trading mode"

    def submit_paper_order(self, client_order_id: str, payload: dict[str, object]) -> BrokerOrderReceipt:
        return BrokerOrderReceipt(client_order_id, None, "unavailable", "xtquant is disabled")

    def query_paper_order(self, broker_order_id: str | None, client_order_id: str) -> BrokerOrderReceipt:
        return BrokerOrderReceipt(client_order_id, broker_order_id, "unavailable", "xtquant is disabled")


register_adapter("mock", MockBrokerAdapter)
register_adapter("xtquant", XtQuantUnavailableAdapter)
