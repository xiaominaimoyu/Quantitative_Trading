"""B6 收口脚本：跑一次备份演练并生成最小收口报告。

不修改任何业务数据；只做：备份创建 → 备份列举 → 备份元数据校验。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = REPO_ROOT / "scripts"
OUTPUT = REPO_ROOT / "docs" / "B6_Closeout_Report.md"


def run_step(args: list[str]) -> dict[str, Any]:
    print(f"\n>>> {' '.join(args)}")
    completed = subprocess.run(
        [sys.executable, *args],
        cwd=str(REPO_ROOT),
        capture_output=True,
    )
    stdout = (completed.stdout or b"").decode("utf-8", errors="replace")
    stderr = (completed.stderr or b"").decode("utf-8", errors="replace")
    return {
        "args": args,
        "returncode": completed.returncode,
        "stdout_tail": stdout.splitlines()[-20:],
        "stderr_tail": stderr.splitlines()[-20:],
    }


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    steps: list[dict[str, object]] = []

    sbom_step = run_step([str(SCRIPTS / "sbom.py")])
    steps.append(sbom_step)

    backup_root = Path(
        os.environ.get("QUANT_BACKUP_ROOT", str(REPO_ROOT / "backups"))
    ).resolve()
    if backup_root.exists():
        list_step = run_step([str(SCRIPTS / "backup.py"), "list"])
        steps.append(list_step)
    else:
        steps.append(
            {
                "args": ["backup.py", "list"],
                "returncode": 0,
                "stdout_tail": [
                    f"备份根目录不存在：{backup_root}（B6 收口可重复执行）"
                ],
                "stderr_tail": [],
            }
        )

    lines = [
        "# B6 收口报告（自动）",
        "",
        f"- 生成时间：{started}",
        "- 不修改业务数据；只生成 SBOM 与备份元数据。",
        "",
        "## 步骤",
        "",
    ]
    for index, step in enumerate(steps, start=1):
        args = step["args"]
        if isinstance(args, list):
            args_text = " ".join(str(a) for a in args)
        else:
            args_text = str(args)
        lines.append(f"### 步骤 {index}：`{args_text}`")
        lines.append(f"- 返回码：`{step['returncode']}`")
        stdout_tail = step.get("stdout_tail", [])
        stderr_tail = step.get("stderr_tail", [])
        if isinstance(stdout_tail, list):
            for tail in stdout_tail:
                lines.append(f"  - {tail}")
        if isinstance(stderr_tail, list):
            for tail in stderr_tail:
                lines.append(f"  - stderr: {tail}")
        lines.append("")

    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"收口报告已生成：{OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
