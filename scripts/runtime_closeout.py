"""Exercise the dev closeout path against the dedicated PostgreSQL test DB."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
BACKEND, FRONTEND = ROOT / "backend", ROOT / "frontend"
API_ORIGIN, WEB_ORIGIN = "http://127.0.0.1:8000", "http://localhost:5173"
API_ROOT = f"{API_ORIGIN}/api/v1"
DATABASE_URL = os.getenv(
    "QUANT_SMOKE_DATABASE_URL",
    "postgresql+psycopg://quant:quant_dev_password@127.0.0.1:5432/quant_trading_test",
)


def find_tool(env_name, candidates, label):
    for raw in [os.getenv(env_name), *candidates]:
        if not raw:
            continue
        resolved = shutil.which(str(raw)) or str(raw)
        path = Path(resolved)
        if path.is_file():
            return path.resolve()
    raise RuntimeError(f"{label} not found; set {env_name}")


def find_playwright(node):
    configured = os.getenv("PLAYWRIGHT_MODULE")
    if configured and configured.startswith("file:"):
        return configured
    for path in [
        Path(configured) if configured else None,
        FRONTEND / "node_modules/playwright/index.mjs",
        node.parent.parent / "node_modules/playwright/index.mjs",
        Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
    ]:
        if path and path.is_file():
            return path.resolve().as_uri()
    raise RuntimeError("Playwright not found; set PLAYWRIGHT_MODULE")


def require_file(path, label):
    if not path.is_file():
        raise RuntimeError(f"{label} not found: {path}")
    return path


def validate_environment():
    lowered = DATABASE_URL.lower()
    database = lowered.rsplit("/", 1)[-1].split("?", 1)[0]
    if not lowered.startswith("postgresql+") or not ({"test", "smoke"} & set(database.split("_"))):
        raise RuntimeError("smoke URL must use PostgreSQL and a test/smoke database")
    for port in (8000, 5173):
        with socket.socket() as probe:
            probe.settimeout(0.2)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"required local port is already in use: {port}")


def manage_smoke_database(name=None):
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    template = make_url(DATABASE_URL)
    creating = name is None
    name = name or f"quant_closeout_smoke_{uuid4().hex[:12]}"
    engine = create_engine(template.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            command = "CREATE DATABASE" if creating else "DROP DATABASE IF EXISTS"
            suffix = "" if creating else " WITH (FORCE)"
            connection.exec_driver_sql(f'{command} "{name}"{suffix}')
    finally:
        engine.dispose()
    if creating:
        return name, template.set(database=name).render_as_string(hide_password=False)


def insert_b1_migration_probe(database_url):
    from sqlalchemy import create_engine, text

    dataset_id, version_id = uuid4(), uuid4()
    content_sha256 = "a" * 64
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO datasets "
                    "(id, slug, name, market, frequency, schema_version, license, status) "
                    "VALUES (:id, :slug, :name, 'CN', '1d', 'market_bar_v1', "
                    "'smoke-only', 'active')"
                ),
                {"id": dataset_id, "slug": f"migration-{dataset_id.hex}", "name": f"Migration {dataset_id.hex}"},
            )
            connection.execute(
                text(
                    "INSERT INTO dataset_versions "
                    "(id, dataset_id, version_no, status, quality_status, row_count, content_sha256) "
                    "VALUES (:id, :dataset_id, 1, 'draft', 'pending', 0, :sha256)"
                ),
                {"id": version_id, "dataset_id": dataset_id, "sha256": content_sha256},
            )
    finally:
        engine.dispose()
    return dataset_id, version_id, content_sha256


def verify_b1_migration_probe(database_url, probe):
    from sqlalchemy import create_engine, text

    dataset_id, version_id, expected_sha256 = probe
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT dataset_id, logical_content_sha256 FROM dataset_versions "
                    "WHERE id = :id"
                ),
                {"id": version_id},
            ).one()
        if str(row.dataset_id) != str(dataset_id) or row.logical_content_sha256 != expected_sha256:
            raise RuntimeError("0001 -> head did not preserve the migration probe")
    finally:
        engine.dispose()


def run_checked(args, cwd, env, label):
    result = subprocess.run(
        args, cwd=cwd, env=env, text=True, encoding="utf-8", errors="replace",
        capture_output=True, timeout=90, check=False,
    )
    if result.returncode:
        output = (result.stderr or result.stdout)[-1500:]
        for secret in (DATABASE_URL, env.get("QUANT_DATABASE_URL")):
            if secret:
                output = output.replace(secret, "<database-url>")
        raise RuntimeError(f"{label} failed:\n{output}")
    print(f"PASS {label}")
    return result.stdout


def start(args, cwd, env, log_path):
    log = log_path.open("wb")
    process = subprocess.Popen(
        args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=log,
        stderr=subprocess.STDOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return process, log


def stop(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def remove_temp(path):
    base = Path(tempfile.gettempdir()).resolve()
    if path.parent.resolve() != base or not path.name.startswith("qt_closeout_"):
        raise RuntimeError(f"refusing to remove unexpected temp path: {path}")
    for _ in range(10):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            time.sleep(0.2)
    raise RuntimeError(f"temporary runtime directory is still locked: {path}")


def request_json(method, path, token=None, body=None, expected=200, extra_headers=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json", "X-Request-Id": f"SMOKE-{uuid4().hex}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    headers.update(extra_headers or {})
    request = urllib.request.Request(f"{API_ROOT}{path}", data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=8)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = json.loads(response.read().decode())
        if response.status != expected:
            raise RuntimeError(f"{method} {path} returned HTTP {response.status}: {payload}")
        return payload, response.headers


def wait_task(task_id, token, expected_status, timeout=45):
    deadline = time.monotonic() + timeout
    current = {}
    while time.monotonic() < deadline:
        try:
            current, _ = request_json("GET", f"/tasks/{task_id}", token)
        except RuntimeError as error:
            if "returned HTTP 404" not in str(error):
                raise
            time.sleep(0.1)
            continue
        if current.get("status") in {"success", "failed", "cancelled"}:
            break
        time.sleep(0.25)
    if current.get("status") != expected_status:
        raise RuntimeError(
            f"task {task_id} ended as {current.get('status')}, expected {expected_status}"
        )
    return current


def wait_version_status(version_id, token, expected_status, timeout=30):
    deadline = time.monotonic() + timeout
    current = {}
    while time.monotonic() < deadline:
        current, _ = request_json("GET", f"/dataset-versions/{version_id}", token)
        if current.get("status") == expected_status:
            return current
        if current.get("status") in {"available", "failed", "deprecated"}:
            break
        time.sleep(0.02)
    raise RuntimeError(
        f"version {version_id} reached {current.get('status')}, expected {expected_status}"
    )


def create_snapshot(dataset_id, source_id, token, marker, expected_status):
    accepted, _ = request_json(
        "POST",
        f"/datasets/{dataset_id}/versions",
        token,
        {
            "data_source_id": source_id,
            "time_start": "2024-02-05",
            "time_end": "2024-02-07",
            "symbols": ["000001.SZ"],
            "adjustment": "none",
            "timezone": "Asia/Shanghai",
        },
        202,
        {"Idempotency-Key": marker},
    )
    task = wait_task(accepted["task_id"], token, expected_status)
    version, _ = request_json(
        "GET", f"/dataset-versions/{accepted['dataset_version_id']}", token
    )
    return accepted, task, version


def wait_for(url, process, label):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{label} exited early with {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    print(f"PASS {label} ready")
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    raise RuntimeError(f"{label} did not become ready")


def main():
    validate_environment()
    python = find_tool(
        "PYTHON",
        [BACKEND / ".venv/Scripts/python.exe", BACKEND / ".venv/bin/python"],
        "backend Python",
    )
    node = find_tool("NODE", ["node", "node.exe"], "Node.js")
    playwright = find_playwright(node)
    # 本地 Windows 用 Edge；CI/Linux 由 PLAYWRIGHT_EXECUTABLE_PATH 指定 Playwright Chromium（EDGE 可不设）
    edge = None
    if not os.getenv("PLAYWRIGHT_EXECUTABLE_PATH"):
        edge = find_tool(
            "EDGE",
            [
                Path(os.getenv("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe",
                Path(os.getenv("PROGRAMFILES", "")) / "Microsoft/Edge/Application/msedge.exe",
            ],
            "Microsoft Edge (set PLAYWRIGHT_EXECUTABLE_PATH to use Playwright Chromium instead)",
        )
    vite = require_file(FRONTEND / "node_modules/vite/bin/vite.js", "Vite CLI")
    processes = []

    with tempfile.TemporaryDirectory(prefix="qt_closeout_", ignore_cleanup_errors=True) as temp:
        temp_root = Path(temp)
        artifact_root = temp_root / "artifacts"
        database_name, runtime_database_url = manage_smoke_database()
        backend_env = os.environ.copy()
        backend_env.update(
            QUANT_ENV="development", QUANT_DATABASE_URL=runtime_database_url,
            QUANT_ARTIFACT_ROOT=str(artifact_root), QUANT_DATA_ROOT=str(temp_root / "data"),
            QUANT_WORKER_HEARTBEAT_SECONDS="1", QUANT_TASK_LEASE_SECONDS="2",
            PYTHONDONTWRITEBYTECODE="1",
        )
        try:
            run_checked(
                [str(python), "-m", "alembic", "upgrade", "head"],
                BACKEND, backend_env, "empty PostgreSQL -> head migration",
            )
            run_checked(
                [str(python), "-m", "alembic", "downgrade", "base"],
                BACKEND, backend_env, "reset ephemeral migration probe database",
            )
            run_checked(
                [str(python), "-m", "alembic", "upgrade", "0001"],
                BACKEND, backend_env, "PostgreSQL -> 0001 migration",
            )
            migration_probe = insert_b1_migration_probe(runtime_database_url)
            run_checked(
                [str(python), "-m", "alembic", "upgrade", "head"],
                BACKEND, backend_env, "PostgreSQL 0001 -> head migration",
            )
            verify_b1_migration_probe(runtime_database_url, migration_probe)
            print("PASS 0001 -> head preserves B1 data and content hash")
            run_checked([str(python), "-m", "quant_trading.seed"], BACKEND, backend_env, "seed")

            api, log = start(
                [str(python), "-m", "uvicorn", "quant_trading.main:app", "--host", "127.0.0.1", "--port", "8000"],
                BACKEND, backend_env, temp_root / "api.log",
            )
            processes.append((api, log))
            wait_for(f"{API_ROOT}/health/live", api, "API")

            session, _ = request_json(
                "POST", "/auth/dev-session",
                body={"login_name": "runtime-closeout", "role": "researcher"},
            )
            token = session["token"]
            me, _ = request_json("GET", "/auth/me", token)
            if me.get("login_name") != "runtime-closeout":
                raise RuntimeError("auth/me identity mismatch")
            print("PASS dev-session -> auth/me")

            marker = f"SMOKE_REAL_{uuid4().hex[:10]}"
            dataset, _ = request_json(
                "POST", "/datasets", token,
                {"slug": marker.lower().replace("_", "-"), "name": marker,
                 "market": "SMOKE", "frequency": "daily", "license": "smoke-only"},
                201,
                {"Idempotency-Key": f"dataset-{uuid4().hex}"},
            )
            dataset_id = dataset["id"]
            versions, _ = request_json("GET", f"/datasets/{dataset_id}/versions", token)
            if not versions["items"]:
                raise RuntimeError("created dataset has no version")

            sources, _ = request_json("GET", "/data-sources?page_size=100", token)
            fixture_sources = {
                item["name"]: item
                for item in sources["items"]
                if item["adapter"] == "deterministic_fixture"
            }
            clean_source = fixture_sources.get("Deterministic fixture (clean)")
            blocked_source = fixture_sources.get("Deterministic fixture (blocked)")
            if not clean_source or not blocked_source:
                raise RuntimeError("clean/blocked deterministic fixture sources are missing")

            worker, log = start(
                [str(python), "-m", "quant_trading.worker"],
                BACKEND, backend_env, temp_root / "worker.log",
            )
            processes.append((worker, log))

            crash_symbols = [f"{value:06d}.SZ" for value in range(273)]
            crash_accepted, _ = request_json(
                "POST",
                f"/datasets/{dataset_id}/versions",
                token,
                {
                    "data_source_id": clean_source["id"],
                    "time_start": "2024-01-01",
                    "time_end": "2024-12-31",
                    "symbols": crash_symbols,
                    "adjustment": "none",
                    "timezone": "Asia/Shanghai",
                },
                202,
                {"Idempotency-Key": f"crash-{uuid4().hex}"},
            )
            wait_version_status(crash_accepted["dataset_version_id"], token, "validating")
            stop(worker)
            recovery_worker, recovery_log = start(
                [str(python), "-m", "quant_trading.worker"],
                BACKEND, backend_env, temp_root / "worker-recovery.log",
            )
            processes.append((recovery_worker, recovery_log))
            recovered_task = wait_task(
                crash_accepted["task_id"], token, "success", timeout=90
            )
            recovered_version, _ = request_json(
                "GET",
                f"/dataset-versions/{crash_accepted['dataset_version_id']}",
                token,
            )
            if recovered_task["attempt_count"] < 2 or not (
                recovered_version["status"] == "available"
                and recovered_version["eligible_for_formal_use"]
            ):
                raise RuntimeError("expired Worker lease did not recover the interrupted snapshot")
            worker = recovery_worker
            print("PASS killed Worker -> expired lease -> safe staging recovery")

            clean_accepted, _, clean_version = create_snapshot(
                dataset_id,
                clean_source["id"],
                token,
                f"clean-{uuid4().hex}",
                "success",
            )
            clean_version_id = clean_accepted["dataset_version_id"]
            if not (
                clean_version["status"] == "available"
                and clean_version["quality_status"] == "passed"
                and clean_version["eligible_for_formal_use"]
                and clean_version["gate_decision"] == "eligible"
            ):
                raise RuntimeError("clean snapshot did not become eligible")
            manifest = clean_version.get("manifest")
            if not manifest or manifest["logical_content_sha256"] != clean_version["logical_content_sha256"]:
                raise RuntimeError("clean snapshot manifest/hash metadata is incomplete")
            version_dir = (
                temp_root / "data" / "datasets" / dataset_id / "versions" / clean_version_id
            )
            manifest_bytes = (version_dir / "manifest.json").read_bytes()
            if hashlib.sha256(manifest_bytes).hexdigest() != clean_version["manifest_sha256"]:
                raise RuntimeError("manifest bytes do not match database/API hash")
            for partition in manifest["partitions"]:
                relative = Path(partition["relative_path"])
                if relative.is_absolute() or ".." in relative.parts:
                    raise RuntimeError("manifest exposed an unsafe partition path")
                content = (version_dir / relative).read_bytes()
                if hashlib.sha256(content).hexdigest() != partition["file_sha256"]:
                    raise RuntimeError("partition bytes do not match manifest hash")
            clean_artifacts, _ = request_json(
                "GET", f"/tasks/{clean_accepted['task_id']}/artifacts", token
            )
            if {item["artifact_type"] for item in clean_artifacts} != {
                "dataset_partition", "dataset_manifest", "data_quality_report"
            } or any("uri" in item for item in clean_artifacts):
                raise RuntimeError("snapshot artifact metadata is incomplete or leaks a URI")

            query, _ = request_json(
                "POST", f"/dataset-versions/{clean_version_id}/query", token,
                {
                    "columns": ["event_time", "symbol", "close", "volume"],
                    "start": "2024-02-05T00:00:00+00:00",
                    "end": "2024-02-07T23:59:59+00:00",
                    "symbols": ["000001.SZ"],
                    "limit": 2,
                },
            )
            if len(query["items"]) != 2 or not query["page"]["has_more"]:
                raise RuntimeError("DuckDB keyset first page is invalid")
            query_page_2, _ = request_json(
                "POST", f"/dataset-versions/{clean_version_id}/query", token,
                {
                    "columns": ["event_time", "symbol", "close", "volume"],
                    "start": "2024-02-05T00:00:00+00:00",
                    "end": "2024-02-07T23:59:59+00:00",
                    "symbols": ["000001.SZ"],
                    "limit": 2,
                    "cursor": query["page"]["next_cursor"],
                },
            )
            rows = [*query["items"], *query_page_2["items"]]
            if len(rows) != 3 or len({item["event_time"] for item in rows}) != 3:
                raise RuntimeError("DuckDB keyset pages contain a gap or duplicate")
            aggregate, _ = request_json(
                "POST", f"/dataset-versions/{clean_version_id}/aggregate", token,
                {
                    "metrics": ["count", "sum_volume"],
                    "start": "2024-02-05T00:00:00+00:00",
                    "end": "2024-02-07T23:59:59+00:00",
                    "symbols": ["000001.SZ"],
                    "max_points": 10,
                },
            )
            if aggregate["source_rows"] != 3 or len(aggregate["points"]) != 3:
                raise RuntimeError("DuckDB aggregate result is invalid")
            print("PASS clean snapshot -> hashes -> quality gate -> DuckDB")

            blocked_accepted, blocked_task, blocked_version = create_snapshot(
                dataset_id,
                blocked_source["id"],
                token,
                f"blocked-{uuid4().hex}",
                "failed",
            )
            if not (
                blocked_task.get("error_code") == "QUALITY_GATE_BLOCKED"
                and blocked_version["status"] == "failed"
                and blocked_version["quality_status"] == "blocked"
                and not blocked_version["eligible_for_formal_use"]
                and blocked_version["manifest"] is None
            ):
                raise RuntimeError("blocked snapshot escaped its terminal quality gate")
            blocked_query, _ = request_json(
                "POST", f"/dataset-versions/{blocked_accepted['dataset_version_id']}/query", token,
                {
                    "columns": ["symbol"],
                    "start": "2024-02-05T00:00:00+00:00",
                    "end": "2024-02-07T23:59:59+00:00",
                },
                409,
            )
            if blocked_query.get("error", {}).get("code") != "DATASET_VERSION_NOT_QUERYABLE":
                raise RuntimeError("blocked snapshot query did not return the stable gate error")
            blocked_dir = (
                temp_root / "data" / "datasets" / dataset_id / "versions"
                / blocked_accepted["dataset_version_id"]
            )
            if blocked_dir.exists():
                raise RuntimeError("blocked snapshot was committed to the final directory")
            blocked_lineage, _ = request_json(
                "GET",
                f"/dataset-versions/{blocked_accepted['dataset_version_id']}/lineage",
                token,
            )
            if blocked_lineage["edges"]:
                raise RuntimeError("blocked snapshot exposed committed lineage")
            print("PASS blocked snapshot -> failed task -> query denied")

            web_env = os.environ.copy()
            web_env.update(
                VITE_API_MODE="real", VITE_API_BASE_URL=API_ROOT,
                VITE_DEV_LOGIN_NAME="runtime-browser",
            )
            web, log = start(
                [str(node), str(vite), "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
                FRONTEND, web_env, temp_root / "vite.log",
            )
            processes.append((web, log))
            wait_for("http://127.0.0.1:5173", web, "Vite")
            browser_env = web_env.copy()
            browser_env.update(
                PLAYWRIGHT_MODULE=playwright,
                WEB_ORIGIN=WEB_ORIGIN,
                DATASET_MARKER=marker, DATASET_ID=dataset_id,
                CLEAN_SOURCE_NAME=clean_source["name"],
                CLEAN_VERSION_ID=clean_version_id,
                BLOCKED_VERSION_ID=blocked_accepted["dataset_version_id"],
                BLOCKED_TASK_ID=blocked_accepted["task_id"],
                MISSING_DATASET_ID=str(uuid4()),
            )
            if edge:
                browser_env["EDGE"] = str(edge)
            # PLAYWRIGHT_EXECUTABLE_PATH（如已设）会优先被 browser_closeout.mjs 使用
            browser_output = run_checked(
                [str(node), str(ROOT / "scripts/browser_closeout.mjs")],
                ROOT, browser_env, "Edge B2 snapshot workflow",
            )
            browser_result = json.loads(browser_output.strip().splitlines()[-1])
            browser_version, _ = request_json(
                "GET", f"/dataset-versions/{browser_result['version_id']}", token
            )
            if (
                browser_version["logical_content_sha256"]
                != clean_version["logical_content_sha256"]
            ):
                raise RuntimeError("same frozen input did not rebuild the same logical hash")
            print("PASS frontend real create -> same logical content SHA-256")

            task, _ = request_json(
                "POST", "/tasks", token,
                {"task_type": "diagnostic", "payload": {"probe": marker}}, 201,
            )
            task_id = task["id"]
            wait_task(task_id, token, "success")

            artifacts, _ = request_json("GET", f"/tasks/{task_id}/artifacts", token)
            if len(artifacts) != 1 or "uri" in artifacts[0]:
                raise RuntimeError("artifact metadata missing or leaked storage URI")
            metadata = artifacts[0]
            artifact_id = metadata["id"]
            detail, _ = request_json("GET", f"/artifacts/{artifact_id}", token)
            if detail != metadata:
                raise RuntimeError("artifact list/detail metadata mismatch")
            content = (artifact_root / "tasks" / task_id / f"{artifact_id}.json").read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            if len(content) != metadata["size_bytes"] or digest != metadata["sha256"]:
                raise RuntimeError("artifact bytes do not match API metadata")
            print("PASS diagnostic -> worker -> artifact -> API")
            print(json.dumps(
                {"status": "PASS", "dataset_id": dataset_id,
                 "clean_version_id": clean_version_id,
                 "blocked_version_id": blocked_accepted["dataset_version_id"],
                 "browser_version_id": browser_result["version_id"],
                 "logical_content_sha256": clean_version["logical_content_sha256"],
                 "task_id": task_id, "artifact_id": artifact_id,
                 "artifact_sha256": digest, "artifact_size": len(content)},
                indent=2,
            ))
            return 0
        finally:
            for process, log in reversed(processes):
                stop(process)
                log.close()
            try:
                remove_temp(temp_root)
            finally:
                manage_smoke_database(database_name)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # CLI boundary
        print(f"FAIL runtime closeout: {error}", file=sys.stderr)
        raise SystemExit(1)
