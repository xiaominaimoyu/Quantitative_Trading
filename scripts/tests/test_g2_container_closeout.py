"""Fail-closed command and cleanup guard tests for the G2 container closeout."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "g2_container_closeout", ROOT / "scripts" / "g2_container_closeout.py"
)
assert SPEC is not None and SPEC.loader is not None
closeout = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = closeout
SPEC.loader.exec_module(closeout)


def test_resource_names_are_unique_and_cleanup_is_exact():
    names = closeout.ResourceNames.create("0123456789ab")

    assert len(set(names.containers)) == len(names.containers)
    assert all(name.startswith("qt-g2-0123456789ab-") for name in names.containers)
    assert names.network == "qt-g2-0123456789ab-net"
    assert names.image == "quant-trading-g2-closeout:0123456789ab"
    assert "quant_trading_postgres" not in {
        *names.containers,
        names.network,
        names.image,
    }
    for kind, name in closeout.cleanup_targets(names):
        names.validate_cleanup_target(kind, name)


def test_cleanup_guard_rejects_unowned_resources():
    names = closeout.ResourceNames.create("0123456789ab")

    with pytest.raises(closeout.CloseoutError, match="unowned container"):
        names.validate_cleanup_target("container", "quant_trading_postgres")
    with pytest.raises(closeout.CloseoutError, match="unowned network"):
        names.validate_cleanup_target("network", "bridge")
    with pytest.raises(closeout.CloseoutError, match="unowned image"):
        names.validate_cleanup_target("image", "postgres:17")


def test_commands_use_unique_network_tmpfs_loopback_and_no_published_ports():
    names = closeout.ResourceNames.create("0123456789ab")
    temp_root = Path(tempfile.gettempdir()) / f"{closeout.TEMP_PREFIX}commands"

    build = closeout.docker_build_command(ROOT, names)
    postgres = closeout.postgres_run_command(names, names.postgres_source)
    api = closeout.app_run_command(
        names,
        names.api,
        names.postgres_source,
        temp_root,
        ["python", "-m", "quant_trading.main"],
        detach=True,
    )

    assert build[-2:] == [names.image, str((ROOT / "backend").resolve())]
    assert postgres[-1] == "postgres:17"
    assert "/var/lib/postgresql/data:rw" in postgres
    assert names.network in postgres
    assert not {"--publish", "-p", "--volume", "-v"}.intersection(postgres)
    assert "QUANT_BIND_HOST=127.0.0.1" in api
    assert f"@{names.postgres_source}:5432/{names.database}" in " ".join(api)
    assert not {"--publish", "-p", "--volume", "-v"}.intersection(api)


def test_temp_cleanup_guard_only_accepts_owned_direct_child():
    owned = Path(tempfile.gettempdir()) / f"{closeout.TEMP_PREFIX}012345"
    closeout.validate_temp_root(owned)

    with pytest.raises(closeout.CloseoutError, match="unexpected temporary path"):
        closeout.validate_temp_root(ROOT)
    with pytest.raises(closeout.CloseoutError, match="unexpected temporary path"):
        closeout.validate_temp_root(owned / "nested")
