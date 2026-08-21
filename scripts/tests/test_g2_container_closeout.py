"""Fail-closed command and cleanup guard tests for the G2 container closeout."""
from __future__ import annotations

import importlib.util
import re
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


def test_health_contract_accepts_current_runtime_shape():
    closeout.validate_health_responses(
        {"status": "ok"},
        {"status": "ready", "database": "reachable"},
    )


def test_health_contract_rejects_wrong_live_status():
    with pytest.raises(closeout.CloseoutError, match="unexpected live health response"):
        closeout.validate_health_responses(
            {"status": "down"},
            {"status": "ready", "database": "reachable"},
        )


def test_health_contract_rejects_wrong_ready_status():
    with pytest.raises(closeout.CloseoutError, match="unexpected ready health response"):
        closeout.validate_health_responses(
            {"status": "ok"},
            {"status": "degraded", "database": "reachable"},
        )


def test_health_contract_rejects_wrong_database_status():
    with pytest.raises(closeout.CloseoutError, match="unexpected ready database response"):
        closeout.validate_health_responses(
            {"status": "ok"},
            {"status": "ready", "database": "unreachable"},
        )


def system_health() -> dict:
    return {
        "status": "ok",
        "database": "reachable",
        "migration": {
            "current": "0007_recovered_worker_queue",
            "head": "0007_recovered_worker_queue",
        },
    }


def test_system_health_contract_returns_verified_current_migration():
    assert (
        closeout.validate_system_health_response(system_health())
        == "0007_recovered_worker_queue"
    )


@pytest.mark.parametrize("response", [None, [], "not-a-system-response"])
def test_system_health_contract_rejects_non_objects(response):
    with pytest.raises(closeout.CloseoutError, match="not an object"):
        closeout.validate_system_health_response(response)


def test_system_health_contract_rejects_missing_migration():
    response = system_health()
    response.pop("migration")
    with pytest.raises(closeout.CloseoutError, match="migration was not an object"):
        closeout.validate_system_health_response(response)


@pytest.mark.parametrize(
    "migration",
    [None, [], {}, {"current": "0007_recovered_worker_queue", "head": None}],
)
def test_system_health_contract_rejects_missing_or_non_object_migration(migration):
    response = system_health()
    response["migration"] = migration
    with pytest.raises(closeout.CloseoutError):
        closeout.validate_system_health_response(response)


@pytest.mark.parametrize(
    "migration",
    [
        {"current": None, "head": "0007_recovered_worker_queue"},
        {"current": "", "head": "0007_recovered_worker_queue"},
        {"current": 7, "head": "0007_recovered_worker_queue"},
        {"current": "0007_recovered_worker_queue", "head": None},
        {"current": "0007_recovered_worker_queue", "head": ""},
        {"current": "0007_recovered_worker_queue", "head": 7},
    ],
)
def test_system_health_contract_rejects_invalid_migration_revisions(migration):
    response = system_health()
    response["migration"] = migration
    with pytest.raises(closeout.CloseoutError):
        closeout.validate_system_health_response(response)


@pytest.mark.parametrize(
    ("field", "value"),
    [("status", "degraded"), ("database", "unreachable")],
)
def test_system_health_contract_rejects_unhealthy_source(field, value):
    response = system_health()
    response[field] = value
    with pytest.raises(closeout.CloseoutError):
        closeout.validate_system_health_response(response)


def test_system_health_contract_rejects_migration_drift():
    response = system_health()
    response["migration"]["head"] = "0006_g5_paper_trading"
    with pytest.raises(closeout.CloseoutError, match="did not match head"):
        closeout.validate_system_health_response(response)


def test_restore_expectation_uses_verified_system_migration():
    source = (ROOT / "scripts" / "g2_container_closeout.py").read_text(encoding="utf-8")
    assert not re.search(r"ready\s*\[\s*['\"]migration['\"]\s*\]", source)
    assert '"alembic_version": migration_current' in source


def test_api_request_passes_optional_idempotency_key_to_api_client(monkeypatch):
    commands: list[list[str]] = []

    def fake_run_checked(command, **_kwargs):
        commands.append(command)
        return '{"status": 201, "body": {"id": "ok"}}'

    monkeypatch.setattr(closeout, "run_checked", fake_run_checked)

    assert (
        closeout.api_request(
            "token-api",
            "POST",
            "/api/v1/datasets",
            body={"name": "probe"},
            token="session-token",
            idempotency_key="g2-utf8-probe-0123456789ab",
            expected=201,
        )
        == {"id": "ok"}
    )
    assert "G2_TOKEN=session-token" in commands[0]
    assert "G2_IDEMPOTENCY_KEY=g2-utf8-probe-0123456789ab" in commands[0]
    assert 'idempotency_key = os.environ.get("G2_IDEMPOTENCY_KEY")' in closeout.API_CLIENT
    assert 'headers["Idempotency-Key"] = idempotency_key' in closeout.API_CLIENT


def test_api_request_without_idempotency_key_remains_compatible(monkeypatch):
    commands: list[list[str]] = []

    def fake_run_checked(command, **_kwargs):
        commands.append(command)
        return '{"status": 200, "body": {"status": "ok"}}'

    monkeypatch.setattr(closeout, "run_checked", fake_run_checked)

    assert closeout.api_request("token-api", "GET", "/api/v1/health/live") == {
        "status": "ok"
    }
    assert not any(item.startswith("G2_IDEMPOTENCY_KEY=") for item in commands[0])


PROBE_ID = "abcdefab-1234-4abc-8def-abcdefabcdef"
PROBE_NAME = "G2 UTF-8 恢复探针 0123456789ab"
PROBE_SLUG = "g2-utf8-probe-0123456789ab"


def probe_response(**overrides):
    return {"id": PROBE_ID, "name": PROBE_NAME, "slug": PROBE_SLUG} | overrides


def test_dataset_probe_response_requires_exact_uuid_name_and_slug():
    assert (
        closeout.validate_dataset_probe_response(
            probe_response(id=PROBE_ID.upper()), PROBE_NAME, PROBE_SLUG
        )
        == PROBE_ID
    )


@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        {"id": PROBE_ID, "name": PROBE_NAME},
        {"id": PROBE_ID, "slug": PROBE_SLUG},
        {"name": PROBE_NAME, "slug": PROBE_SLUG},
    ],
)
def test_dataset_probe_response_rejects_non_objects_and_missing_fields(response):
    with pytest.raises(closeout.CloseoutError):
        closeout.validate_dataset_probe_response(response, PROBE_NAME, PROBE_SLUG)


@pytest.mark.parametrize(
    "probe_id",
    ["not-a-uuid", f"'{PROBE_ID}'", f"{PROBE_ID}' OR '1'='1"],
)
def test_dataset_probe_response_rejects_noncanonicalizable_ids(probe_id):
    with pytest.raises(closeout.CloseoutError, match="valid UUID"):
        closeout.validate_dataset_probe_response(
            probe_response(id=probe_id), PROBE_NAME, PROBE_SLUG
        )


@pytest.mark.parametrize(
    "response",
    [
        probe_response(name="other name"),
        probe_response(slug="other-slug"),
    ],
)
def test_dataset_probe_response_rejects_name_and_slug_mismatches(response):
    with pytest.raises(closeout.CloseoutError):
        closeout.validate_dataset_probe_response(response, PROBE_NAME, PROBE_SLUG)


def expected_snapshot() -> dict[str, object]:
    return {
        "alembic_version": "0007_recovered_worker_queue",
        "task_status": "success",
        "task_payload": {"message": "G2 容器恢复 UTF-8", "timezone": "Asia/Shanghai"},
        "artifact_count": 1,
        "artifact_sha256": "a" * 64,
        "utf8_probe_id": PROBE_ID,
        "utf8_probe_count": 1,
        "utf8_probe_name": PROBE_NAME,
    }


def test_database_snapshot_accepts_exact_probe_for_source_and_restore():
    snapshot = expected_snapshot()

    closeout.validate_database_snapshot(snapshot, expected_snapshot(), "source")
    closeout.validate_database_snapshot(snapshot, expected_snapshot(), "restored")


@pytest.mark.parametrize("count", [0, 2, "1", None])
def test_database_snapshot_rejects_invalid_probe_count(count):
    snapshot = expected_snapshot() | {"utf8_probe_count": count}

    with pytest.raises(closeout.CloseoutError, match="source database snapshot utf8_probe_count"):
        closeout.validate_database_snapshot(snapshot, expected_snapshot(), "source")


def test_database_snapshot_rejects_probe_name_mismatch_with_restore_label():
    snapshot = expected_snapshot() | {"utf8_probe_name": "wrong"}

    with pytest.raises(closeout.CloseoutError, match="restored database snapshot utf8_probe_name"):
        closeout.validate_database_snapshot(snapshot, expected_snapshot(), "restored")


def test_database_snapshot_canonicalizes_probe_uuid_before_sql(monkeypatch):
    commands: list[list[str]] = []
    raw_probe_id = PROBE_ID.upper()

    def fake_run_checked(command, **_kwargs):
        commands.append(command)
        return "{}"

    monkeypatch.setattr(closeout, "run_checked", fake_run_checked)
    names = closeout.ResourceNames.create("0123456789ab")

    closeout.database_snapshot(
        names.postgres_source,
        names,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        raw_probe_id,
    )

    sql = commands[0][-1]
    assert PROBE_ID in sql
    assert raw_probe_id not in sql


def test_probe_snapshot_source_has_no_static_seed_assumption():
    source = (ROOT / "scripts" / "g2_container_closeout.py").read_text(encoding="utf-8")

    assert "A 股日频行情" not in source
    assert "utf8_seed_count" not in source
    assert 'probe_slug = f"g2-utf8-probe-{names.token}"' in source
    assert 'probe_name = f"G2 UTF-8 恢复探针 {names.token}"' in source
    assert 'canonical_uuid(probe_dataset_id, "dataset probe id")' in source
    assert 'validate_database_snapshot(source_snapshot, expected_snapshot, "source")' in source
    assert 'validate_database_snapshot(restored, expected_snapshot, "restored")' in source
