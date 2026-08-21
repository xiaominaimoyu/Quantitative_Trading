"""Frozen-artifact compatibility export for retained front-end tooling.

The runtime ASGI application is always :mod:`quant_trading.main.app`.  The
legacy front-end generator invokes ``create_app`` with ``QUANT_ENV=test``;
that narrow code path intentionally exports the frozen historical OpenAPI
artifact so it does not overwrite retained generated client files.  It is not
a runtime OpenAPI implementation or a runtime-contract validation mechanism.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from quant_trading.main import app


class FrozenHistoricalContractArtifactExport:
    """Read-only export view used only by the legacy artifact generator."""

    def openapi(self) -> dict[str, Any]:
        contract_path = Path(__file__).resolve().parents[2] / "frontend" / "openapi.json"
        if not contract_path.is_file():
            raise RuntimeError("Frozen OpenAPI artifact is unavailable")
        return json.loads(contract_path.read_text(encoding="utf-8"))


def create_app() -> Any:
    if os.getenv("QUANT_ENV") == "test":
        # The retained Node generator decodes the child process as UTF-8.  On
        # Windows, explicitly align Python's stdout so Chinese contract text
        # survives the round trip without changing the tracked OpenAPI file.
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        return FrozenHistoricalContractArtifactExport()
    return app
