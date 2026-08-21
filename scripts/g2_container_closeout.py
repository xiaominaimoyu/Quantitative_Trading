"""Run the reproducible G2 Linux container and recovery closeout."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4


ROOT = Path(__file__).resolve().parents[1]
POSTGRES_IMAGE = "postgres:17"
POSTGRES_USER = "quant"
POSTGRES_PASSWORD = "g2-closeout-password"
TEMP_PREFIX = "qt_g2_container_closeout_"
TOKEN_PATTERN = re.compile(r"^[0-9a-f]{12}$")


class CloseoutError(RuntimeError):
    """A fail-closed orchestration error."""


@dataclass(frozen=True)
class ResourceNames:
    token: str
    image: str
    network: str
    postgres_source: str
    migrate: str
    seed: str
    api: str
    worker: str
    platform: str
    postgres_restore: str
    database: str

    @classmethod
    def create(cls, token: str | None = None) -> "ResourceNames":
        token = token or uuid4().hex[:12]
        if not TOKEN_PATTERN.fullmatch(token):
            raise ValueError("resource token must be exactly 12 lowercase hex characters")
        prefix = f"qt-g2-{token}"
        return cls(
            token=token,
            image=f"quant-trading-g2-closeout:{token}",
            network=f"{prefix}-net",
            postgres_source=f"{prefix}-pg-src",
            migrate=f"{prefix}-migrate",
            seed=f"{prefix}-seed",
            api=f"{prefix}-api",
            worker=f"{prefix}-worker",
            platform=f"{prefix}-platform",
            postgres_restore=f"{prefix}-pg-dst",
            database=f"qt_g2_{token}",
        )

    @property
    def containers(self) -> tuple[str, ...]:
        return (
            self.postgres_source,
            self.migrate,
            self.seed,
            self.api,
            self.worker,
            self.platform,
            self.postgres_restore,
        )

    def validate_cleanup_target(self, kind: str, name: str) -> None:
        allowed = {
            "container": set(self.containers),
            "network": {self.network},
            "image": {self.image},
        }
        if kind not in allowed or name not in allowed[kind]:
            raise CloseoutError(f"refusing to clean unowned {kind}: {name}")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def redact(value: str) -> str:
    return value.replace(POSTGRES_PASSWORD, "<ephemeral-password>")


def run_checked(
    args: list[str],
    *,
    cwd: Path = ROOT,
    timeout: float = 120,
    input_text: str | None = None,
) -> str:
    try:
        result = subprocess.run(
            args,
            cwd=cwd,
            input=input_text,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CloseoutError(f"command could not complete: {args[:3]}: {exc}") from exc
    if result.returncode:
        detail = redact((result.stderr or result.stdout or "no output")[-3000:])
        raise CloseoutError(
            f"command failed ({result.returncode}): {args[:3]}\n{detail}"
        )
    return result.stdout.strip()


def docker_build_command(root: Path, names: ResourceNames) -> list[str]:
    return [
        "docker",
        "build",
        "--pull=false",
        "--tag",
        names.image,
        str((root / "backend").resolve()),
    ]


def postgres_run_command(names: ResourceNames, container: str) -> list[str]:
    if container not in {names.postgres_source, names.postgres_restore}:
        raise CloseoutError(f"refusing to start unowned PostgreSQL container: {container}")
    return [
        "docker",
        "run",
        "--detach",
        "--name",
        container,
        "--network",
        names.network,
        "--env",
        f"POSTGRES_USER={POSTGRES_USER}",
        "--env",
        f"POSTGRES_PASSWORD={POSTGRES_PASSWORD}",
        "--env",
        f"POSTGRES_DB={names.database}",
        "--tmpfs",
        "/var/lib/postgresql/data:rw",
        POSTGRES_IMAGE,
    ]


def database_url(names: ResourceNames, postgres_container: str) -> str:
    return (
        f"postgresql+psycopg://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
        f"@{postgres_container}:5432/{names.database}"
    )


def app_run_command(
    names: ResourceNames,
    container: str,
    postgres_container: str,
    temp_root: Path,
    command: list[str],
    *,
    detach: bool = False,
) -> list[str]:
    if container not in {names.migrate, names.seed, names.api, names.worker}:
        raise CloseoutError(f"refusing to start unowned application container: {container}")
    result = ["docker", "run"]
    if detach:
        result.append("--detach")
    result.extend(
        [
            "--name",
            container,
            "--network",
            names.network,
            "--env",
            "QUANT_ENV=development",
            "--env",
            "QUANT_BIND_HOST=127.0.0.1",
            "--env",
            f"QUANT_DATABASE_URL={database_url(names, postgres_container)}",
            "--env",
            "QUANT_ARTIFACT_ROOT=/g2/artifacts",
            "--env",
            "QUANT_DATA_ROOT=/g2/data",
            "--env",
            "QUANT_WORKER_HEARTBEAT_SECONDS=1",
            "--env",
            "QUANT_TASK_LEASE_SECONDS=5",
            "--mount",
            f"type=bind,source={temp_root.resolve()},target=/g2",
            names.image,
            *command,
        ]
    )
    return result


def platform_run_command(
    root: Path, names: ResourceNames, temp_root: Path
) -> list[str]:
    return [
        "docker",
        "run",
        "--name",
        names.platform,
        "--network",
        "none",
        "--mount",
        f"type=bind,source={(root / 'scripts').resolve()},target=/g2_scripts,readonly",
        "--mount",
        f"type=bind,source={temp_root.resolve()},target=/g2",
        names.image,
        "python",
        "/g2_scripts/g2_platform_probe.py",
        "--root",
        "/g2/platform",
    ]


def cleanup_targets(names: ResourceNames) -> list[tuple[str, str]]:
    return [
        *[("container", name) for name in reversed(names.containers)],
        ("network", names.network),
        ("image", names.image),
    ]


def _inspect_command(kind: str, name: str) -> list[str]:
    noun = {"container": "container", "network": "network", "image": "image"}[kind]
    return ["docker", noun, "inspect", name]


def _remove_command(kind: str, name: str) -> list[str]:
    return {
        "container": ["docker", "container", "rm", "--force", name],
        "network": ["docker", "network", "rm", name],
        "image": ["docker", "image", "rm", "--force", name],
    }[kind]


def _docker_exists(kind: str, name: str) -> bool:
    try:
        result = subprocess.run(
            _inspect_command(kind, name),
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CloseoutError(f"could not inspect {kind} {name}: {exc}") from exc
    if result.returncode == 0:
        return True
    detail = (result.stderr or result.stdout).lower()
    if "no such" in detail or "not found" in detail:
        return False
    raise CloseoutError(f"could not inspect {kind} {name}: {redact(detail[-1000:])}")


def cleanup_docker(names: ResourceNames) -> dict[str, object]:
    results: dict[str, str] = {}
    for kind, name in cleanup_targets(names):
        key = f"{kind}:{name}"
        try:
            names.validate_cleanup_target(kind, name)
            if not _docker_exists(kind, name):
                results[key] = "absent"
                continue
            run_checked(_remove_command(kind, name), timeout=60)
            if _docker_exists(kind, name):
                raise CloseoutError(f"{kind} still exists after cleanup: {name}")
            results[key] = "removed"
        except Exception as exc:  # cleanup must continue across independent resources
            results[key] = f"FAILED: {redact(str(exc))}"
    return {
        "resources": results,
        "all_clean": all(value in {"absent", "removed"} for value in results.values()),
    }


def validate_temp_root(path: Path) -> None:
    resolved = path.resolve()
    expected_parent = Path(tempfile.gettempdir()).resolve()
    if resolved.parent != expected_parent or not resolved.name.startswith(TEMP_PREFIX):
        raise CloseoutError(f"refusing to remove unexpected temporary path: {resolved}")


def remove_temp_root(path: Path) -> str:
    validate_temp_root(path)
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        return "absent"
    if path.exists():
        raise CloseoutError(f"temporary path still exists after cleanup: {path}")
    return "removed"


def wait_postgres(container: str, names: ResourceNames, timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            run_checked(
                [
                    "docker",
                    "exec",
                    container,
                    "pg_isready",
                    "--username",
                    POSTGRES_USER,
                    "--dbname",
                    names.database,
                ],
                timeout=10,
            )
            return
        except CloseoutError as exc:
            last_error = exc
            time.sleep(0.5)
    raise CloseoutError(f"PostgreSQL did not become ready: {last_error}")


API_CLIENT = r"""
import base64, json, os, urllib.error, urllib.request
body = base64.b64decode(os.environ.get("G2_BODY", "")) or None
headers = {"Accept": "application/json", "Content-Type": "application/json"}
token = os.environ.get("G2_TOKEN")
if token:
    headers["Authorization"] = "Bearer " + token
idempotency_key = os.environ.get("G2_IDEMPOTENCY_KEY")
if idempotency_key:
    headers["Idempotency-Key"] = idempotency_key
request = urllib.request.Request(
    "http://127.0.0.1:8000" + os.environ["G2_PATH"],
    data=body,
    headers=headers,
    method=os.environ["G2_METHOD"],
)
try:
    response = urllib.request.urlopen(request, timeout=5)
except urllib.error.HTTPError as error:
    response = error
with response:
    raw = response.read().decode("utf-8")
    print(json.dumps({"status": response.status, "body": json.loads(raw)}, ensure_ascii=False))
""".strip()


def api_request(
    container: str,
    method: str,
    path: str,
    *,
    body: dict[str, object] | None = None,
    token: str | None = None,
    idempotency_key: str | None = None,
    expected: int = 200,
) -> object:
    raw_body = b"" if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    command = [
        "docker",
        "exec",
        "--env",
        f"G2_METHOD={method}",
        "--env",
        f"G2_PATH={path}",
        "--env",
        f"G2_BODY={base64.b64encode(raw_body).decode('ascii')}",
    ]
    if token:
        command.extend(["--env", f"G2_TOKEN={token}"])
    if idempotency_key:
        command.extend(["--env", f"G2_IDEMPOTENCY_KEY={idempotency_key}"])
    command.extend([container, "python", "-c", API_CLIENT])
    envelope = json.loads(run_checked(command, timeout=15))
    if envelope["status"] != expected:
        raise CloseoutError(
            f"{method} {path} returned {envelope['status']}, expected {expected}: "
            f"{envelope['body']}"
        )
    return envelope["body"]


def wait_api(container: str, timeout: float = 60) -> tuple[dict, dict]:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            live = api_request(container, "GET", "/api/v1/health/live")
            ready = api_request(container, "GET", "/api/v1/health/ready")
            if not isinstance(live, dict) or not isinstance(ready, dict):
                raise CloseoutError("health response was not an object")
            return live, ready
        except (CloseoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(0.5)
    raise CloseoutError(f"loopback API did not become ready: {last_error}")


def validate_health_responses(live: dict, ready: dict) -> None:
    """Validate the reconstructed runtime health contract without side effects."""
    if live.get("status") != "ok":
        raise CloseoutError(f"unexpected live health response: {live}")
    if ready.get("status") != "ready":
        raise CloseoutError(f"unexpected ready health response: {ready}")
    if ready.get("database") != "reachable":
        raise CloseoutError(f"unexpected ready database response: {ready}")


def validate_system_health_response(system: object) -> str:
    """Return the verified source migration revision from system health."""
    if not isinstance(system, dict):
        raise CloseoutError("system health response was not an object")
    if system.get("status") != "ok":
        raise CloseoutError("unexpected system health status")
    if system.get("database") != "reachable":
        raise CloseoutError("unexpected system health database status")
    migration = system.get("migration")
    if not isinstance(migration, dict):
        raise CloseoutError("system health migration was not an object")
    current = migration.get("current")
    head = migration.get("head")
    if not isinstance(current, str) or not current:
        raise CloseoutError("system health migration current was not a non-empty string")
    if not isinstance(head, str) or not head:
        raise CloseoutError("system health migration head was not a non-empty string")
    if current != head:
        raise CloseoutError("system health migration current did not match head")
    return current


def wait_task(container: str, task_id: str, token: str, timeout: float = 60) -> dict:
    deadline = time.monotonic() + timeout
    current: object = {}
    while time.monotonic() < deadline:
        current = api_request(container, "GET", f"/api/v1/tasks/{task_id}", token=token)
        if isinstance(current, dict) and current.get("status") in {"success", "failed"}:
            break
        time.sleep(0.5)
    if not isinstance(current, dict) or current.get("status") != "success":
        raise CloseoutError(f"diagnostic task did not succeed: {current}")
    return current


def parse_json_output(output: str, label: str) -> dict:
    try:
        value = json.loads(output)
    except json.JSONDecodeError as exc:
        raise CloseoutError(f"{label} did not return JSON: {output[-1000:]}") from exc
    if not isinstance(value, dict):
        raise CloseoutError(f"{label} JSON was not an object")
    return value


def canonical_uuid(value: object, label: str) -> str:
    """Return a UUID in canonical form before it is used in a SQL literal."""
    if not isinstance(value, str):
        raise CloseoutError(f"{label} was not a UUID string")
    try:
        return str(UUID(value))
    except (AttributeError, TypeError, ValueError) as exc:
        raise CloseoutError(f"{label} was not a valid UUID") from exc


def validate_dataset_probe_response(
    response: object, expected_name: str, expected_slug: str
) -> str:
    """Fail closed unless the API created precisely the token-scoped probe."""
    if not isinstance(response, dict):
        raise CloseoutError("dataset probe response was not an object")
    if "id" not in response or "name" not in response or "slug" not in response:
        raise CloseoutError("dataset probe response was missing id, name, or slug")
    probe_dataset_id = canonical_uuid(response["id"], "dataset probe id")
    if response["name"] != expected_name:
        raise CloseoutError("dataset probe response name did not match")
    if response["slug"] != expected_slug:
        raise CloseoutError("dataset probe response slug did not match")
    return probe_dataset_id


def validate_database_snapshot(
    snapshot: object, expected: dict[str, object], label: str
) -> None:
    """Require source and restored database facts to match one shared oracle."""
    if not isinstance(snapshot, dict):
        raise CloseoutError(f"{label} database snapshot was not an object")
    for field, expected_value in expected.items():
        if snapshot.get(field) != expected_value:
            raise CloseoutError(f"{label} database snapshot {field} did not match expected")


def database_snapshot(
    container: str,
    names: ResourceNames,
    task_id: str,
    artifact_id: str,
    probe_dataset_id: str,
) -> dict:
    task_id = canonical_uuid(task_id, "diagnostic task id")
    artifact_id = canonical_uuid(artifact_id, "diagnostic artifact id")
    probe_dataset_id = canonical_uuid(probe_dataset_id, "dataset probe id")
    sql = f"""
SELECT json_build_object(
  'alembic_version', (SELECT version_num FROM alembic_version LIMIT 1),
  'task_status', (SELECT status FROM tasks WHERE id = '{task_id}'),
  'task_payload', (SELECT payload::json FROM tasks WHERE id = '{task_id}'),
  'artifact_count', (SELECT count(*) FROM artifacts WHERE generated_by_task_id = '{task_id}'),
  'artifact_sha256', (SELECT sha256 FROM artifacts WHERE id = '{artifact_id}'),
  'utf8_probe_id', (SELECT id::text FROM datasets WHERE id = '{probe_dataset_id}'),
  'utf8_probe_count', (SELECT count(*) FROM datasets WHERE id = '{probe_dataset_id}'),
  'utf8_probe_name', (SELECT name FROM datasets WHERE id = '{probe_dataset_id}')
)::text;
""".strip()
    output = run_checked(
        [
            "docker",
            "exec",
            "--env",
            f"PGPASSWORD={POSTGRES_PASSWORD}",
            container,
            "psql",
            "--username",
            POSTGRES_USER,
            "--dbname",
            names.database,
            "--tuples-only",
            "--no-align",
            "--set",
            "ON_ERROR_STOP=1",
            "--command",
            sql,
        ],
        timeout=30,
    )
    return parse_json_output(output, "PostgreSQL database snapshot")


def execute(root: Path, names: ResourceNames, temp_root: Path) -> dict[str, object]:
    required = [
        root / "backend" / "Dockerfile",
        root / "backend" / "requirements.lock",
        root / "scripts" / "g2_platform_probe.py",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise CloseoutError(f"required files are missing: {missing}")
    if shutil.which("docker") is None:
        raise CloseoutError("Docker CLI was not found")

    for directory in ("artifacts", "data", "platform", "backup", "restored"):
        (temp_root / directory).mkdir(parents=True, exist_ok=True)

    checks: dict[str, object] = {}
    started = time.monotonic()
    build_started = time.monotonic()
    run_checked(docker_build_command(root, names), timeout=600)
    image_id = run_checked(
        ["docker", "image", "inspect", "--format", "{{.Id}}", names.image]
    )
    checks["image_build"] = {
        "status": "PASS",
        "image": names.image,
        "image_id": image_id,
        "seconds": round(time.monotonic() - build_started, 3),
    }

    run_checked(["docker", "network", "create", names.network])
    checks["isolated_network"] = {"status": "PASS", "network": names.network}

    run_checked(postgres_run_command(names, names.postgres_source))
    wait_postgres(names.postgres_source, names)
    checks["postgres_source"] = {
        "status": "PASS",
        "image": POSTGRES_IMAGE,
        "published_ports": [],
        "named_volumes": [],
    }

    run_checked(
        app_run_command(
            names,
            names.migrate,
            names.postgres_source,
            temp_root,
            ["python", "-m", "alembic", "upgrade", "head"],
        ),
        timeout=120,
    )
    run_checked(
        app_run_command(
            names,
            names.seed,
            names.postgres_source,
            temp_root,
            ["python", "-m", "quant_trading.seed"],
        ),
        timeout=120,
    )
    checks["migrate_seed"] = {"status": "PASS"}

    run_checked(
        app_run_command(
            names,
            names.api,
            names.postgres_source,
            temp_root,
            ["python", "-m", "quant_trading.main"],
            detach=True,
        )
    )
    live, ready = wait_api(names.api)
    validate_health_responses(live, ready)
    system = api_request(names.api, "GET", "/api/v1/health/system")
    migration_current = validate_system_health_response(system)
    checks["loopback_health"] = {
        "status": "PASS",
        "bind_host": "127.0.0.1",
        "published_ports": [],
        "live": live,
        "ready": ready,
        "system": system,
    }

    session = api_request(
        names.api,
        "POST",
        "/api/v1/auth/dev-session",
        body={"login_name": "g2-container-closeout", "role": "researcher"},
    )
    if not isinstance(session, dict) or not isinstance(session.get("token"), str):
        raise CloseoutError("dev-session did not return a token")
    token = session["token"]
    probe_slug = f"g2-utf8-probe-{names.token}"
    probe_name = f"G2 UTF-8 恢复探针 {names.token}"
    probe = api_request(
        names.api,
        "POST",
        "/api/v1/datasets",
        body={
            "name": probe_name,
            "slug": probe_slug,
            "market": "local",
            "frequency": "daily",
            "license": "local-reconstructed",
            "schema_version": "market_bar_v1",
        },
        token=token,
        idempotency_key=f"g2-utf8-probe-{names.token}",
        expected=201,
    )
    probe_dataset_id = validate_dataset_probe_response(probe, probe_name, probe_slug)
    checks["utf8_dataset_probe"] = {
        "status": "PASS",
        "dataset_id": probe_dataset_id,
        "name": probe_name,
        "slug": probe_slug,
    }

    marker = "G2 容器恢复 UTF-8"
    expected_payload = {"message": marker, "timezone": "Asia/Shanghai"}
    task = api_request(
        names.api,
        "POST",
        "/api/v1/tasks",
        body={
            "task_type": "diagnostic",
            "payload": expected_payload,
            "priority": 10,
        },
        token=token,
        expected=201,
    )
    if not isinstance(task, dict) or not isinstance(task.get("id"), str):
        raise CloseoutError("task creation did not return an id")
    task_id = canonical_uuid(task["id"], "diagnostic task id")

    run_checked(
        app_run_command(
            names,
            names.worker,
            names.postgres_source,
            temp_root,
            ["python", "-m", "quant_trading.worker"],
            detach=True,
        )
    )
    completed_task = wait_task(names.api, task_id, token)
    artifacts = api_request(
        names.api,
        "GET",
        f"/api/v1/tasks/{task_id}/artifacts",
        token=token,
    )
    if not isinstance(artifacts, list) or len(artifacts) != 1:
        raise CloseoutError(f"diagnostic task artifact list was unexpected: {artifacts}")
    artifact = artifacts[0]
    if not isinstance(artifact, dict) or artifact.get("artifact_type") != "task_result":
        raise CloseoutError(f"diagnostic task artifact was invalid: {artifact}")
    artifact_id = canonical_uuid(artifact.get("id"), "diagnostic artifact id")
    artifact_path = temp_root / "artifacts" / "tasks" / task_id / f"{artifact_id}.json"
    if not artifact_path.is_file():
        raise CloseoutError(f"diagnostic artifact file was not created: {artifact_path}")
    artifact_sha256 = sha256(artifact_path)
    if artifact_sha256 != artifact.get("sha256"):
        raise CloseoutError("diagnostic artifact bytes did not match database metadata")
    artifact_body = json.loads(artifact_path.read_text(encoding="utf-8"))
    if artifact_body.get("payload", {}).get("message") != marker:
        raise CloseoutError("diagnostic artifact did not preserve UTF-8 payload")
    checks["diagnostic_task"] = {
        "status": "PASS",
        "task_id": task_id,
        "task_status": completed_task["status"],
        "attempt_count": completed_task["attempt_count"],
        "artifact_id": artifact_id,
        "artifact_sha256": artifact_sha256,
        "utf8_marker": marker,
    }

    platform = parse_json_output(
        run_checked(platform_run_command(root, names, temp_root), timeout=120),
        "g2_platform_probe",
    )
    required_platform = {
        "status": "PASS",
        "path_has_space": True,
        "path_has_non_ascii": True,
        "schema_timezone": "UTC",
        "same_device": True,
        "atomic_directory_replace": True,
        "probe_removed": True,
    }
    for field, expected in required_platform.items():
        if platform.get(field) != expected:
            raise CloseoutError(
                f"g2_platform_probe {field}={platform.get(field)!r}, expected {expected!r}"
            )
    checks["platform_probe"] = platform

    expected_snapshot = {
        "alembic_version": migration_current,
        "task_status": "success",
        "task_payload": expected_payload,
        "artifact_count": 1,
        "artifact_sha256": artifact_sha256,
        "utf8_probe_id": probe_dataset_id,
        "utf8_probe_count": 1,
        "utf8_probe_name": probe_name,
    }
    source_snapshot = database_snapshot(
        names.postgres_source,
        names,
        task_id,
        artifact_id,
        probe_dataset_id,
    )
    validate_database_snapshot(source_snapshot, expected_snapshot, "source")
    checks["postgres_source_snapshot"] = {"status": "PASS", **source_snapshot}

    dump_name = f"{names.token}.dump"
    run_checked(
        [
            "docker",
            "exec",
            "--env",
            f"PGPASSWORD={POSTGRES_PASSWORD}",
            names.postgres_source,
            "pg_dump",
            "--username",
            POSTGRES_USER,
            "--dbname",
            names.database,
            "--format",
            "custom",
            "--file",
            f"/tmp/{dump_name}",
        ],
        timeout=120,
    )
    dump_path = temp_root / "backup" / "postgres.dump"
    run_checked(
        ["docker", "cp", f"{names.postgres_source}:/tmp/{dump_name}", str(dump_path)],
        timeout=60,
    )
    if not dump_path.is_file() or dump_path.stat().st_size == 0:
        raise CloseoutError("pg_dump did not produce a non-empty backup")

    run_checked(postgres_run_command(names, names.postgres_restore))
    wait_postgres(names.postgres_restore, names)
    run_checked(
        ["docker", "cp", str(dump_path), f"{names.postgres_restore}:/tmp/{dump_name}"],
        timeout=60,
    )
    run_checked(
        [
            "docker",
            "exec",
            "--env",
            f"PGPASSWORD={POSTGRES_PASSWORD}",
            names.postgres_restore,
            "pg_restore",
            "--username",
            POSTGRES_USER,
            "--dbname",
            names.database,
            "--no-owner",
            "--no-privileges",
            "--exit-on-error",
            f"/tmp/{dump_name}",
        ],
        timeout=120,
    )
    restored = database_snapshot(
        names.postgres_restore,
        names,
        task_id,
        artifact_id,
        probe_dataset_id,
    )
    validate_database_snapshot(restored, expected_snapshot, "restored")
    checks["postgres_restore"] = {
        "status": "PASS",
        "dump_bytes": dump_path.stat().st_size,
        "dump_sha256": sha256(dump_path),
        **restored,
    }

    backup_artifact = temp_root / "backup" / "artifact.json"
    restored_artifact = temp_root / "restored" / "artifact.json"
    shutil.copy2(artifact_path, backup_artifact)
    shutil.copy2(backup_artifact, restored_artifact)
    restored_sha256 = sha256(restored_artifact)
    if not (
        sha256(backup_artifact) == restored_sha256 == artifact_sha256
        and json.loads(restored_artifact.read_text(encoding="utf-8"))["payload"]["message"]
        == marker
    ):
        raise CloseoutError("restored artifact failed SHA-256 or UTF-8 verification")
    checks["artifact_restore"] = {
        "status": "PASS",
        "sha256": restored_sha256,
        "utf8_marker": marker,
    }
    checks["execution_seconds"] = round(time.monotonic() - started, 3)
    return checks


def main() -> int:
    names = ResourceNames.create()
    temp_root = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX)).resolve()
    summary: dict[str, object] = {
        "status": "FAIL",
        "run_id": names.token,
        "started_at": utc_now(),
        "workspace": str(ROOT),
        "resources": {
            "image": names.image,
            "network": names.network,
            "containers": list(names.containers),
            "temp_root": str(temp_root),
        },
        "checks": {},
    }
    primary_error: str | None = None
    try:
        summary["checks"] = execute(ROOT, names, temp_root)
    except Exception as exc:
        primary_error = redact(f"{type(exc).__name__}: {exc}")
        summary["error"] = primary_error
    finally:
        cleanup = cleanup_docker(names)
        try:
            cleanup["temp_root"] = remove_temp_root(temp_root)
        except Exception as exc:
            cleanup["temp_root"] = f"FAILED: {redact(str(exc))}"
            cleanup["all_clean"] = False
        summary["cleanup"] = cleanup
        summary["finished_at"] = utc_now()

    cleanup_ok = bool(summary["cleanup"].get("all_clean")) and summary["cleanup"].get(
        "temp_root"
    ) in {"removed", "absent"}
    if primary_error is None and cleanup_ok:
        summary["status"] = "PASS"
    elif primary_error is None:
        summary["error"] = "cleanup did not complete"
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
