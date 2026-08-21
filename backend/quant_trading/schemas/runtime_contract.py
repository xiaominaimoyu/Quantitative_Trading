"""Pydantic models for the runtime auth and paper-trading API surface.

They document and validate the live reconstructed endpoint boundary.  The
separate frozen historical export remains only an artifact-compatibility aid.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RuntimeContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


DevRole = Literal["researcher", "auditor", "admin"]
PaperAccountStatus = Literal["active", "stopped", "error"]
PaperOrderStatus = Literal[
    "planned",
    "blocked",
    "submitting",
    "submitted",
    "unknown",
    "partially_filled",
    "filled",
    "cancel_pending",
    "cancelled",
    "rejected",
]


class DevSessionRequest(RuntimeContractModel):
    login_name: str = Field(min_length=1, max_length=128)
    role: DevRole


class DevSessionResponse(RuntimeContractModel):
    token: str = Field(min_length=1)
    expires_at: datetime
    role: DevRole
    scopes: list[str]


class AuthMeResponse(RuntimeContractModel):
    login_name: str
    role: DevRole
    scopes: list[str]


class TaskCreate(RuntimeContractModel):
    """Frozen public task-create boundary: only local diagnostics are public."""

    task_type: Literal["diagnostic"]
    priority: int = Field(default=100, ge=0, le=1000)
    payload: dict[str, Any] | None = None


# B2 request boundaries mirror the frozen historical artifact while validating
# input at the live endpoint rather than relying on ad-hoc dict parsing.
VersionSymbol = Annotated[
    str,
    Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._-]+$"),
]
QuerySymbol = Annotated[str, Field(min_length=1, max_length=64)]


class DatasetCreate(RuntimeContractModel):
    name: str = Field(min_length=1, max_length=128)
    market: str = Field(min_length=1, max_length=32)
    frequency: str = Field(default="daily", max_length=16)
    license: str = Field(default="internal", max_length=128)
    schema_version: str = Field(default="1.0", max_length=32)
    slug: str | None = Field(default=None, min_length=1, max_length=64)


class DatasetVersionCreate(RuntimeContractModel):
    data_source_id: UUID
    time_start: date
    time_end: date
    symbols: list[VersionSymbol] = Field(min_length=1, max_length=1000)
    parent_version_id: UUID | None = None
    timezone: Literal["Asia/Shanghai"] = "Asia/Shanghai"
    adjustment: Literal["none", "forward", "backward"] = "none"


class RowQueryRequest(RuntimeContractModel):
    start: datetime
    end: datetime
    columns: list[
        Literal[
            "symbol",
            "exchange",
            "event_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "available_at",
            "ingested_at",
            "source_revision",
        ]
    ] = Field(min_length=1, max_length=11)
    symbols: list[QuerySymbol] | None = Field(default=None, max_length=1000)
    cursor: str | None = Field(default=None, max_length=2048)
    limit: int = Field(default=100, ge=1, le=100)


class AggregateRequest(RuntimeContractModel):
    start: datetime
    end: datetime
    metrics: list[Literal["count", "avg_close", "sum_volume", "min_low", "max_high"]] = Field(
        min_length=1,
        max_length=5,
    )
    symbols: list[QuerySymbol] | None = Field(default=None, max_length=1000)
    max_points: int = Field(default=1000, ge=1, le=1000)


class PaperAccountResponse(RuntimeContractModel):
    id: UUID
    name: str
    status: PaperAccountStatus
    initial_capital: Decimal = Field(ge=0)
    cash: Decimal = Field(ge=0)
    stop_reason: str | None = None
    stopped_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    # Snapshot-only UI extensions.  They stay optional for the stop mutation's
    # account summary while retaining the precise runtime snapshot shape.
    total: Decimal | None = Field(default=None, ge=0)
    available: Decimal | None = Field(default=None, ge=0)
    market_value: Decimal | None = Field(default=None, ge=0)
    day_pnl: Decimal | None = None
    day_pnl_pct: Decimal | None = None


class PaperPositionResponse(RuntimeContractModel):
    symbol: str
    exchange: str
    name: str
    quantity: Decimal = Field(ge=0)
    avg_price: Decimal = Field(ge=0)
    market_value: Decimal = Field(ge=0)
    pnl: Decimal
    pnl_pct: Decimal


class PaperOrderResponse(RuntimeContractModel):
    id: UUID
    account_id: UUID
    client_order_id: str
    broker_order_id: str | None = None
    symbol: str
    exchange: str
    side: Literal["buy", "sell"]
    direction: Literal["buy", "sell"]
    order_type: str
    quantity: Decimal = Field(gt=0)
    price: Decimal | None = Field(default=None, ge=0)
    filled_quantity: Decimal = Field(ge=0)
    avg_fill_price: Decimal | None = Field(default=None, ge=0)
    status: PaperOrderStatus
    error_code: str | None = None
    error_message: str | None = None
    submitted_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CursorPage(RuntimeContractModel):
    has_more: bool
    next_cursor: int | None = Field(default=None, ge=0)


class PaperOrdersResponse(RuntimeContractModel):
    items: list[PaperOrderResponse]
    page: CursorPage


class PaperSnapshotResponse(RuntimeContractModel):
    status: Literal["running", "stopped"]
    account: PaperAccountResponse
    positions: list[PaperPositionResponse]
    orders: list[PaperOrderResponse]
    recent_orders: list[PaperOrderResponse]
    open_order_count: int = Field(ge=0)
    updated_at: datetime


class PaperStopRequest(RuntimeContractModel):
    account_id: UUID | None = None
    reason: str | None = Field(default=None, min_length=1, max_length=2000)


class PaperStopResponse(RuntimeContractModel):
    account: PaperAccountResponse
    snapshot: PaperSnapshotResponse
    audit_event_id: UUID


class PaperReconciliationResponse(RuntimeContractModel):
    id: UUID
    account_id: UUID
    status: Literal["running", "completed", "failed"]
    result_status: Literal["matched", "difference"]
    execution_status: Literal["running", "completed", "failed"]
    discrepancies: list[dict[str, Any]]
    started_at: datetime
    completed_at: datetime | None = None
    created_at: datetime
    checked_targets_count: int = Field(ge=0)
    differences_count: int = Field(ge=0)
    summary: str


class PaperReconciliationsResponse(RuntimeContractModel):
    items: list[PaperReconciliationResponse]
    page: CursorPage


class PaperReconciliationDetailResponse(PaperReconciliationResponse):
    run: PaperReconciliationResponse
    items: list[dict[str, Any]]


class PaperDailyReportResponse(RuntimeContractModel):
    account_id: UUID
    date: date
    trades: list[dict[str, Any]]
    risk: dict[str, Any]
    exceptions: list[str]
    reconciliation: dict[str, Any]
    day_pnl: Decimal
    day_pnl_pct: Decimal
    turnover: Decimal = Field(ge=0)
    total_fees: Decimal = Field(ge=0)
    filled_orders_count: int = Field(ge=0)
    unknown_orders_count: int = Field(ge=0)
    notes: str
