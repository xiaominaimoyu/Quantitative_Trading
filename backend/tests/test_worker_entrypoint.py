"""Tests for the worker package entry point without starting its loop."""

from __future__ import annotations

import importlib
import runpy
import sys

import quant_trading.worker as worker


def test_worker_package_entrypoint_is_importable() -> None:
    module = importlib.import_module("quant_trading.worker.__main__")
    assert module.main is worker.main


def test_worker_package_entrypoint_calls_main_guard(monkeypatch) -> None:
    called: list[bool] = []
    monkeypatch.setattr(worker, "main", lambda: called.append(True))
    sys.modules.pop("quant_trading.worker.__main__", None)

    runpy.run_module("quant_trading.worker.__main__", run_name="__main__")

    assert called == [True]
