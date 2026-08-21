"""Offline regression checks for the reconstructed runtime closeout harness."""

from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "runtime_closeout.py"


def load_closeout_module():
    spec = importlib.util.spec_from_file_location("runtime_closeout_recovery_test", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_closeout_uses_reconstructed_baseline_and_logical_hash() -> None:
    module = load_closeout_module()
    source = inspect.getsource(module)

    assert '"0005_b5_validation_reports_risk"' in source
    assert '"upgrade", "0001"' not in source
    probe_source = inspect.getsource(module.insert_b1_migration_probe)
    assert "logical_content_sha256" in probe_source
    assert 'row_count, content_sha256)' not in probe_source
    assert '"canceled"' in inspect.getsource(module.wait_task)
    assert "initial version" in source


def test_closeout_binary_download_helper_keeps_bearer_and_bytes(monkeypatch) -> None:
    module = load_closeout_module()
    seen = {}

    class Response:
        status = 200
        headers = {"Content-Type": "application/vnd.apache.parquet"}

        def read(self):
            return b"PAR1fixturePAR1"

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

    def open_request(request, timeout):
        seen["request"] = request
        seen["timeout"] = timeout
        return Response()

    monkeypatch.setattr(module.urllib.request, "urlopen", open_request)
    content, headers = module.request_bytes("GET", "/artifacts/example/download", token="test-token")

    assert content == b"PAR1fixturePAR1"
    assert headers["Content-Type"] == "application/vnd.apache.parquet"
    assert seen["request"].get_header("Authorization") == "Bearer test-token"
    assert seen["timeout"] == 8
