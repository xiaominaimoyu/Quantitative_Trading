"""Arrow schema for the reconstructed ``market_bar_v1`` local fixture."""

from __future__ import annotations

import pyarrow as pa


# All timestamps are UTC instants.  Prices deliberately use a fixed decimal
# representation so the deterministic fixture does not introduce binary-float
# rounding into a persisted snapshot.
MARKET_BAR_SCHEMA = pa.schema(
    [
        pa.field("symbol", pa.string(), nullable=False),
        pa.field("exchange", pa.string(), nullable=False),
        pa.field("event_time", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("open", pa.decimal128(20, 6), nullable=False),
        pa.field("high", pa.decimal128(20, 6), nullable=False),
        pa.field("low", pa.decimal128(20, 6), nullable=False),
        pa.field("close", pa.decimal128(20, 6), nullable=False),
        pa.field("volume", pa.int64(), nullable=False),
        pa.field("available_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("ingested_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("source_revision", pa.string(), nullable=False),
    ]
)
