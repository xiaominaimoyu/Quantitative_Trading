"""Write deterministic market_bar_v1 Parquet and time a bounded DuckDB scan."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from quant_trading.data.schema import MARKET_BAR_SCHEMA
from quant_trading.data.snapshot import WRITER_PROFILE

MAX_ROWS = 30_000_000


def _windows_peak_working_set_bytes() -> int:
    import ctypes
    from ctypes import wintypes

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(ProcessMemoryCounters),
        wintypes.DWORD,
    ]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL

    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(
        kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    return int(counters.PeakWorkingSetSize)


def process_peak_memory() -> dict:
    """Return the OS-maintained cumulative memory peak for this process."""
    if sys.platform == "win32":
        peak_bytes = _windows_peak_working_set_bytes()
        source = "GetProcessMemoryInfo.PeakWorkingSetSize"
        source_unit = "bytes"
    elif sys.platform.startswith("linux"):
        import resource

        peak_bytes = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1024
        source = "resource.getrusage(RUSAGE_SELF).ru_maxrss"
        source_unit = "KiB"
    else:
        raise RuntimeError(f"unsupported platform for peak memory: {sys.platform}")
    return {
        "bytes": peak_bytes,
        "mib": round(peak_bytes / (1024 * 1024), 2),
        "source": source,
        "source_unit": source_unit,
        "semantics": "OS-maintained cumulative peak for this process",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=100_000)
    parser.add_argument("--batch-rows", type=int, default=100_000)
    parser.add_argument(
        "--baseline",
        action="store_true",
        help="also run a deterministic equal-weight close-to-close workload",
    )
    args = parser.parse_args()
    if not 1 <= args.rows <= MAX_ROWS:
        parser.error(f"--rows must be between 1 and {MAX_ROWS}")
    if not 1 <= args.batch_rows <= 1_000_000:
        parser.error("--batch-rows must be between 1 and 1000000")
    return args


def market_bar_batch(offset: int, size: int) -> pa.Table:
    epoch = datetime(2010, 1, 4, 7, tzinfo=timezone.utc)
    rows = []
    for position in range(offset, offset + size):
        symbol_no = position % 6_000
        event_time = epoch + timedelta(days=position // 6_000)
        close = Decimal("10.000000") + Decimal(position % 1_000) / 1_000
        rows.append(
            {
                "symbol": f"{symbol_no:06d}.SZ",
                "exchange": "SZ",
                "event_time": event_time,
                "open": close - Decimal("0.010000"),
                "high": close + Decimal("0.020000"),
                "low": close - Decimal("0.020000"),
                "close": close,
                "volume": 1_000 + position % 10_000,
                "available_at": event_time + timedelta(minutes=5),
                "ingested_at": event_time + timedelta(minutes=10),
                "source_revision": "capacity-probe-v1",
            }
        )
    return pa.Table.from_pylist(rows, schema=MARKET_BAR_SCHEMA)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def run_baseline(parquet_path: Path, temp_directory: Path) -> dict:
    """Run a one-thread, all-row baseline workload; this is not strategy validation."""
    started = time.perf_counter()
    with duckdb.connect(
        database=":memory:",
        config={
            "threads": "1",
            "memory_limit": "20GB",
            "temp_directory": str(temp_directory),
        },
    ) as connection:
        result = connection.execute(
            """
            WITH per_symbol AS (
                SELECT
                    CAST(event_time AS DATE) AS trading_day,
                    symbol,
                    CAST(close AS DOUBLE) AS close,
                    lag(CAST(close AS DOUBLE)) OVER (
                        PARTITION BY symbol ORDER BY event_time
                    ) AS previous_close
                FROM read_parquet(?)
            ),
            daily AS (
                SELECT
                    trading_day,
                    count(*) AS symbol_returns,
                    avg(close / previous_close - 1.0) AS daily_return
                FROM per_symbol
                WHERE previous_close IS NOT NULL
                GROUP BY trading_day
            ),
            curve AS (
                SELECT
                    trading_day,
                    symbol_returns,
                    exp(sum(ln(1.0 + daily_return)) OVER (ORDER BY trading_day))
                        AS equity_multiple
                FROM daily
            )
            SELECT
                count(*) AS trading_days,
                min(symbol_returns) AS min_symbol_returns,
                max(symbol_returns) AS max_symbol_returns,
                sum(symbol_returns) AS evaluated_returns,
                arg_max(equity_multiple, trading_day) AS final_equity_multiple
            FROM curve
            """,
            [str(parquet_path)],
        ).fetchone()
    return {
        "name": "synthetic_equal_weight_close_to_close",
        "seconds": round(time.perf_counter() - started, 6),
        "threads": 1,
        "memory_limit": "20GB",
        "trading_days": result[0],
        "min_symbol_returns": result[1],
        "max_symbol_returns": result[2],
        "evaluated_returns": result[3],
        "final_equity_multiple": str(result[4]),
        "research_claim": "performance workload only; not strategy validation",
    }


def run(rows: int, batch_rows: int, *, baseline: bool = False) -> dict:
    with tempfile.TemporaryDirectory(prefix="qt_b2_capacity_") as raw_temp:
        parquet_path = Path(raw_temp) / "market-bar.parquet"
        started = time.perf_counter()
        with pq.ParquetWriter(
            parquet_path,
            MARKET_BAR_SCHEMA,
            version=WRITER_PROFILE["parquet_version"],
            compression=WRITER_PROFILE["compression"],
            compression_level=WRITER_PROFILE["compression_level"],
            use_dictionary=WRITER_PROFILE["use_dictionary"],
            write_statistics=WRITER_PROFILE["write_statistics"],
            data_page_version=WRITER_PROFILE["data_page_version"],
        ) as writer:
            for offset in range(0, rows, batch_rows):
                writer.write_table(
                    market_bar_batch(offset, min(batch_rows, rows - offset)),
                    row_group_size=WRITER_PROFILE["row_group_size"],
                )
        write_seconds = time.perf_counter() - started

        started = time.perf_counter()
        digest = file_sha256(parquet_path)
        hash_seconds = time.perf_counter() - started

        started = time.perf_counter()
        with duckdb.connect(database=":memory:", config={"threads": "1"}) as connection:
            count, average_close = connection.execute(
                "SELECT count(*), avg(close) FROM read_parquet(?) WHERE volume >= ?",
                [str(parquet_path), 0],
            ).fetchone()
        query_seconds = time.perf_counter() - started
        if count != rows:
            raise RuntimeError(f"DuckDB returned {count} rows, expected {rows}")

        result = {
            "status": "PASS",
            "rows": rows,
            "batch_rows": batch_rows,
            "parquet_bytes": parquet_path.stat().st_size,
            "file_sha256": digest,
            "write_seconds": round(write_seconds, 6),
            "hash_seconds": round(hash_seconds, 6),
            "query_seconds": round(query_seconds, 6),
            "write_rows_per_second": round(rows / write_seconds, 2),
            "query_rows_per_second": round(rows / query_seconds, 2),
            "average_close": str(average_close),
            "python": platform.python_version(),
            "pyarrow": pa.__version__,
            "duckdb": duckdb.__version__,
        }
        if baseline:
            result["baseline"] = run_baseline(
                parquet_path, Path(raw_temp) / "duckdb-temp"
            )
        result["process_peak_memory"] = process_peak_memory()
        return result


def main() -> None:
    args = parse_args()
    print(
        json.dumps(
            run(args.rows, args.batch_rows, baseline=args.baseline),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
