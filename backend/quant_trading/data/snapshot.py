"""Writer profile for immutable reconstructed B2 Parquet snapshots."""

from __future__ import annotations


WRITER_PROFILE = {
    "parquet_version": "2.6",
    "compression": "zstd",
    "compression_level": 3,
    "use_dictionary": ["symbol", "exchange"],
    "write_statistics": True,
    "row_group_size": 65536,
    "data_page_version": "2.0",
    "timestamp_unit": "us",
}
