"""Probe UTF-8 paths, timezone-preserving Parquet, and same-volume atomic commit."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pyarrow as pa
import pyarrow.parquet as pq


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def run(root: Path) -> dict:
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="G2 路径 with spaces ", dir=root) as raw_probe:
        probe = Path(raw_probe)
        staging = probe / "staging 数据"
        final = probe / "final 数据"
        staging.mkdir()

        shanghai = ZoneInfo("Asia/Shanghai")
        local_time = datetime(2024, 2, 5, 15, 30, tzinfo=shanghai)
        schema = pa.schema(
            [
                pa.field("event_time", pa.timestamp("us", tz="UTC"), nullable=False),
                pa.field("label", pa.string(), nullable=False),
            ]
        )
        parquet_path = staging / "行情 数据.parquet"
        pq.write_table(
            pa.Table.from_pylist(
                [{"event_time": local_time.astimezone(timezone.utc), "label": "沪深 UTF-8"}],
                schema=schema,
            ),
            parquet_path,
            compression="zstd",
        )
        manifest_path = staging / "清单 manifest.json"
        manifest_bytes = json.dumps(
            {"label": "沪深 UTF-8", "timezone": "Asia/Shanghai"},
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
        with manifest_path.open("wb") as stream:
            stream.write(manifest_bytes)
            stream.flush()
            os.fsync(stream.fileno())

        staging_device = staging.stat().st_dev
        final_parent_device = final.parent.stat().st_dev
        os.replace(staging, final)

        restored = pq.read_table(final / parquet_path.name)
        restored_utc = restored.column("event_time")[0].as_py()
        restored_local = restored_utc.astimezone(shanghai)
        decoded_manifest = json.loads((final / manifest_path.name).read_text(encoding="utf-8"))
        result = {
            "status": "PASS",
            "platform": platform.platform(),
            "python": platform.python_version(),
            "pyarrow": pa.__version__,
            "root": str(root),
            "probe_path": str(probe),
            "path_has_space": " " in str(probe),
            "path_has_non_ascii": not str(probe).isascii(),
            "schema_timezone": str(restored.schema.field("event_time").type.tz),
            "source_asia_shanghai": local_time.isoformat(),
            "restored_utc": restored_utc.isoformat(),
            "restored_asia_shanghai": restored_local.isoformat(),
            "utf8_value": restored.column("label")[0].as_py(),
            "manifest_utf8_value": decoded_manifest["label"],
            "parquet_bytes": (final / parquet_path.name).stat().st_size,
            "parquet_sha256": sha256(final / parquet_path.name),
            "staging_device": staging_device,
            "final_parent_device": final_parent_device,
            "same_device": staging_device == final_parent_device,
            "atomic_directory_replace": not staging.exists() and final.is_dir(),
        }
    result["probe_removed"] = not Path(raw_probe).exists()
    return result


def main() -> None:
    print(json.dumps(run(parse_args().root), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
