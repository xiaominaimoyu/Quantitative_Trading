"""B6 SBOM / 依赖许可报告：基于 backend/requirements.lock 与 frontend/package.json。

输出到 docs/sbom/，包含：
  - backend-deps.json / .cyclonedx.json / .licenses.csv
  - frontend-deps.json / .licenses.csv
  - summary.md

不联网，全部离线解析。
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_LOCK = REPO_ROOT / "backend" / "requirements.lock"
FRONTEND_PKG = REPO_ROOT / "frontend" / "package.json"
OUTPUT_DIR = REPO_ROOT / "docs" / "sbom"


def parse_backend_lock(path: Path) -> list[dict[str, str]]:
    """解析 pip freeze 风格的依赖锁。"""
    if not path.exists():
        return []
    out: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_.\-]+)==([^\s]+)(?:\s+;.*)?$", line)
        if not match:
            continue
        name, version = match.group(1), match.group(2)
        marker = ""
        if " ;" in line:
            marker = line.split(" ;", 1)[1]
        out.append({"name": name, "version": version, "marker": marker})
    return out


def parse_frontend_pkg(path: Path) -> dict[str, list[dict[str, str]]]:
    if not path.exists():
        return {"dependencies": [], "devDependencies": []}
    pkg = json.loads(path.read_text(encoding="utf-8"))
    return {
        "dependencies": [
            {"name": name, "version": version.lstrip("^~=")}
            for name, version in (pkg.get("dependencies") or {}).items()
        ],
        "devDependencies": [
            {"name": name, "version": version.lstrip("^~=")}
            for name, version in (pkg.get("devDependencies") or {}).items()
        ],
    }


def cyclonedx_component(entry: dict[str, str], group: str) -> dict[str, Any]:
    return {
        "type": "library",
        "bom-ref": f"pkg:{group}/{entry['name']}@{entry['version']}",
        "group": group,
        "name": entry["name"],
        "version": entry["version"],
        "purl": f"pkg:generic/{group.lower()}/{entry['name']}@{entry['version']}",
    }


def write_text(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    backend = parse_backend_lock(BACKEND_LOCK)
    frontend = parse_frontend_pkg(FRONTEND_PKG)
    timestamp = datetime.now(timezone.utc).isoformat()

    backend_payload = {
        "generated_at": timestamp,
        "group": "backend",
        "lockfile": str(BACKEND_LOCK.relative_to(REPO_ROOT)),
        "components": backend,
    }
    write_text(
        OUTPUT_DIR / "backend-deps.json",
        json.dumps(backend_payload, ensure_ascii=False, indent=2),
    )
    write_text(
        OUTPUT_DIR / "backend-deps.cyclonedx.json",
        json.dumps(
            {
                "bomFormat": "CycloneDX",
                "specVersion": "1.5",
                "version": 1,
                "metadata": {
                    "timestamp": timestamp,
                    "tools": [{"vendor": "internal", "name": "scripts/sbom.py"}],
                },
                "components": [cyclonedx_component(c, "backend") for c in backend],
            },
            ensure_ascii=False,
            indent=2,
        ),
    )
    write_text(
        OUTPUT_DIR / "backend-licenses.csv",
        "\n".join(["name,version,marker"] + [
            f"{c['name']},{c['version']},\"{c['marker']}\"" for c in backend
        ]),
    )

    frontend_payload = {
        "generated_at": timestamp,
        "group": "frontend",
        "lockfile": str(FRONTEND_PKG.relative_to(REPO_ROOT)),
        "dependencies": frontend["dependencies"],
        "devDependencies": frontend["devDependencies"],
    }
    write_text(
        OUTPUT_DIR / "frontend-deps.json",
        json.dumps(frontend_payload, ensure_ascii=False, indent=2),
    )
    write_text(
        OUTPUT_DIR / "frontend-licenses.csv",
        "\n".join(
            ["name,version"]
            + [f"{c['name']},{c['version']}" for c in frontend["dependencies"]]
        ),
    )

    # 依赖计数
    counts = Counter()
    counts["backend"] = len(backend)
    counts["frontend_runtime"] = len(frontend["dependencies"])
    counts["frontend_dev"] = len(frontend["devDependencies"])

    summary = [
        "# B6 SBOM / 依赖许可摘要",
        "",
        f"- 生成时间：{timestamp}",
        f"- 后端依赖：{counts['backend']}",
        f"- 前端运行时依赖：{counts['frontend_runtime']}",
        f"- 前端开发依赖：{counts['frontend_dev']}",
        "",
        "## 说明",
        "",
        "- 后端依据 `backend/requirements.lock` 解析；",
        "- 前端依据 `frontend/package.json` 解析；",
        "- 当前 SBOM 不含远程漏洞数据；本仓库未获外部安全/SBOM 供应商审批；",
        "- 完整 license 字段在 `frontend/package.json` 中通常缺失，需 B6 之后接入第三方扫描。",
        "",
    ]
    write_text(OUTPUT_DIR / "summary.md", "\n".join(summary))
    print(f"SBOM 已生成：{OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
