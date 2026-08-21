"""Broker adapter protocol and a deliberately local adapter registry."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol, runtime_checkable


class BrokerUnavailable(RuntimeError):
    """Raised when an optional adapter cannot be used in this environment."""


@dataclass(frozen=True, slots=True)
class BrokerOrderReceipt:
    client_order_id: str
    broker_order_id: str | None
    status: str
    message: str | None = None


@runtime_checkable
class BrokerAdapter(Protocol):
    """Minimal execution protocol used only by the paper-trading service."""

    name: str

    def availability(self) -> tuple[bool, str | None]: ...

    def submit_paper_order(self, client_order_id: str, payload: dict[str, object]) -> BrokerOrderReceipt: ...

    def query_paper_order(self, broker_order_id: str | None, client_order_id: str) -> BrokerOrderReceipt: ...


AdapterFactory = Callable[[], BrokerAdapter]
_ADAPTER_FACTORIES: dict[str, AdapterFactory] = {}


def register_adapter(name: str, factory: AdapterFactory) -> None:
    """Register a construction function, not an account or mutable order state."""

    _ADAPTER_FACTORIES[name.strip().lower()] = factory


def build_adapter(name: str = "mock") -> BrokerAdapter:
    factory = _ADAPTER_FACTORIES.get(name.strip().lower())
    if factory is None:
        raise BrokerUnavailable("Requested paper adapter is not registered")
    adapter = factory()
    available, reason = adapter.availability()
    if not available:
        raise BrokerUnavailable(reason or "Requested paper adapter is unavailable")
    return adapter
