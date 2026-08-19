"""B6 备份与恢复演练：生成 PostgreSQL + artifacts 的一致备份。

用法:
    python scripts/backup.py create            # 创建备份
    python scripts/backup.py list             # 列出已有备份
    python scripts/backup.py restore <name>   # 恢复指定备份
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
DEFAULT_BACKUP_ROOT = REPO_ROOT / "backups"
DOCKER_CONTAINER = "quant_trading_postgres"


def backup_root() -> Path:
    return Path(os.environ.get("QUANT_BACKUP_ROOT", str(DEFAULT_BACKUP_ROOT))).resolve()


def database_url() -> str:
    return os.environ.get(
        "QUANT_DATABASE_URL",
        "postgresql+psycopg://quant:quant_dev_password@127.0.0.1:5432/quant_trading",
    )


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _docker_dump(db_name: str, target_file: Path) -> bool:
    """若 Docker 容器在运行，从容器内执行 pg_dump。"""
    check = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", DOCKER_CONTAINER],
        capture_output=True, text=True, encoding="utf-8",
    )
    if check.returncode != 0 or check.stdout.strip() != "true":
        return False
    result = subprocess.run(
        [
            "docker", "exec", DOCKER_CONTAINER,
            "pg_dump", "-U", "quant", "-d", db_name, "-F", "c",
        ],
        capture_output=True,
    )
    if result.returncode != 0:
        print(f"pg_dump 失败：{result.stderr.decode()}")
        return False
    target_file.write_bytes(result.stdout)
    return True


def _local_dump(db_url: str, target_file: Path) -> bool:
    """使用本地 pg_dump 命令（PATH 中需有 pg_dump）。"""
    try:
        from sqlalchemy.engine.url import make_url

        parsed = make_url(db_url)
        host = parsed.host or "127.0.0.1"
        port = parsed.port or 5432
        user = parsed.username or "quant"
        db_name = parsed.database or "quant_trading"
        env = os.environ.copy()
        env["PGPASSWORD"] = parsed.password or "quant_dev_password"
        result = subprocess.run(
            [
                "pg_dump", "-h", host, "-p", str(port), "-U", user,
                "-d", db_name, "-F", "c", "-f", str(target_file),
            ],
            capture_output=True, env=env,
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


def _archive_directory(source: Path, target: Path) -> None:
    with tarfile.open(target, "w:gz") as archive:
        archive.add(source, arcname=source.name)


def cmd_create() -> int:
    root = backup_root()
    target = root / now_stamp()
    target.mkdir(parents=True, exist_ok=True)
    db_dump = target / "postgres.dump"
    artifacts_archive = target / "artifacts.tar.gz"

    db_url = database_url()
    db_name = db_url.rsplit("/", 1)[-1]
    ok = _docker_dump(db_name, db_dump) or _local_dump(db_url, db_dump)
    if not ok:
        print("无法导出 PostgreSQL：未找到运行中的 Docker 容器且本地 pg_dump 不可用。")
        return 1

    artifacts_dir = REPO_ROOT / "artifacts"
    if artifacts_dir.exists():
        _archive_directory(artifacts_dir, artifacts_archive)

    manifest = target / "manifest.json"
    manifest.write_text(
        f'{{"created_at": "{datetime.now(timezone.utc).isoformat()}", '
        f'"database": "{db_name}", "has_artifacts": {artifacts_dir.exists()}}}\n',
        encoding="utf-8",
    )
    print(f"备份已创建：{target}")
    return 0


def cmd_list() -> int:
    root = backup_root()
    if not root.exists():
        print(f"备份根目录不存在：{root}")
        return 0
    entries: list[dict[str, Any]] = []
    for child in sorted(root.iterdir(), reverse=True):
        if not child.is_dir():
            continue
        manifest = child / "manifest.json"
        info: dict[str, Any] = {
            "name": child.name,
            "created_at": datetime.fromtimestamp(
                child.stat().st_mtime, tz=timezone.utc
            ).isoformat(),
            "files": sorted(p.name for p in child.iterdir()),
        }
        if manifest.exists():
            try:
                info["manifest"] = json.loads(manifest.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                info["manifest_error"] = "invalid_json"
        entries.append(info)
    print(json.dumps(entries, ensure_ascii=False, indent=2))
    return 0


def cmd_restore(name: str) -> int:
    root = backup_root()
    source = root / name
    if not source.exists():
        print(f"备份不存在：{source}")
        return 1
    db_dump = source / "postgres.dump"
    if db_dump.exists():
        target_db = os.environ.get("QUANT_RESTORE_DATABASE", "quant_trading")
        subprocess.run(
            [
                "docker", "exec", "-i", DOCKER_CONTAINER,
                "pg_restore", "-U", "quant", "-d", target_db, "--clean", "--if-exists",
            ],
            input=db_dump.read_bytes(),
        )
        print(f"已恢复数据库：{target_db} 从 {db_dump}")
    archive = source / "artifacts.tar.gz"
    if archive.exists():
        target = REPO_ROOT / "artifacts"
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, "r:gz") as tar:
            tar.extractall(target.parent)
        print(f"已解压 artifacts 到 {target}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="B6 备份与恢复")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("create", help="创建新备份")
    sub.add_parser("list", help="列出已有备份")
    restore = sub.add_parser("restore", help="恢复指定备份")
    restore.add_argument("name", help="备份目录名（时间戳）")
    args = parser.parse_args()
    if args.cmd == "create":
        return cmd_create()
    if args.cmd == "list":
        return cmd_list()
    if args.cmd == "restore":
        return cmd_restore(args.name)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(BACKEND_ROOT / "src"))
    raise SystemExit(main())
