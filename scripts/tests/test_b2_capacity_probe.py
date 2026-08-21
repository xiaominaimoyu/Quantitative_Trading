"""Focused tests for the B2 capacity probe's process peak measurement."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
SPEC = importlib.util.spec_from_file_location(
    "b2_capacity_probe", ROOT / "scripts" / "b2_capacity_probe.py"
)
assert SPEC is not None and SPEC.loader is not None
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def test_linux_peak_rss_converts_kib_to_bytes(monkeypatch):
    calls = []
    fake_resource = SimpleNamespace(
        RUSAGE_SELF=7,
        getrusage=lambda target: calls.append(target)
        or SimpleNamespace(ru_maxrss=321),
    )
    monkeypatch.setitem(sys.modules, "resource", fake_resource)
    monkeypatch.setattr(probe.sys, "platform", "linux")

    result = probe.process_peak_memory()

    assert calls == [7]
    assert result == {
        "bytes": 321 * 1024,
        "mib": round(321 / 1024, 2),
        "source": "resource.getrusage(RUSAGE_SELF).ru_maxrss",
        "source_unit": "KiB",
        "semantics": "OS-maintained cumulative peak for this process",
    }


def test_small_run_reports_os_cumulative_process_peak():
    result = probe.run(12_000, 6_000, baseline=True)

    peak = result["process_peak_memory"]
    assert peak["bytes"] > 0
    assert peak["mib"] == round(peak["bytes"] / (1024 * 1024), 2)
    assert peak["semantics"] == "OS-maintained cumulative peak for this process"
    if sys.platform == "win32":
        assert peak["source"] == "GetProcessMemoryInfo.PeakWorkingSetSize"
        assert peak["source_unit"] == "bytes"
