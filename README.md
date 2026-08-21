# Quantitative Trading

> 面向 A 股日线研究的本地、可审计量化研究重建工程；不是实盘交易系统，也不提供收益保证。

## 当前状态

本工作区保留了前端、冻结 OpenAPI artifact、SDLC 文档和部分收口摘要；丢失的后端部分已按这些证据做保守重建。当前可验证的实现包括 FastAPI API、同步 SQLAlchemy/Alembic 迁移、确定性本地 Worker、Parquet/DuckDB 快照、研究版本/实验/验证/报告闭环，以及仅限模拟盘的 G5/G6 护栏。

这不是对历史源代码、历史测试总数、Git baseline tag 或阶段“已通过”结论的复述。历史材料仅是摘要或证据入口；本次恢复的范围、边界和实际验证结果见 [恢复来源说明](docs/RECOVERY_PROVENANCE.md)。

- 不连接行情、券商、xtquant 或外部队列。
- `deterministic_fixture` 仅生成本地确定性测试数据，不是市场数据。
- 不存在实盘下单路径，实盘未获授权。

## 架构

```text
React/Vite 控制台（Mock 默认；部分页面可接本地开发 API）
                         |
                         v
FastAPI /api/v1  ── 同步 SQLAlchemy ── PostgreSQL 或隔离 SQLite 测试
                         |
                         v
本地确定性 Worker ── Arrow/Parquet 快照 ── DuckDB 查询与聚合
```

`/acceptance/*` 与研究域 `/reports`、`/validation-runs` 保持分离。历史冻结 OpenAPI 有 68 条 path、82 个 path-method-operationId；它是前端生成物兼容 artifact，而不是 runtime schema 逐字段等价声明。

## 本地开发

以下步骤仅用于本地开发；操作数据库时请由操作者提供专用的、非生产的数据库 URL。不要把凭据写入仓库。

```powershell
# 后端依赖与本地安装
py -3.12 -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
.\backend\.venv\Scripts\python.exe -m pip install --no-deps -e backend

# 前端锁定安装和安全 mock 默认
Push-Location frontend
npm.cmd ci
Copy-Item .env.example .env.local
Pop-Location
```

开发 API、Worker 和前端可分别启动：

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn quant_trading.main:app --port 8000
```

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m quant_trading.worker
```

```powershell
Set-Location frontend
npm.cmd run dev
```

前端默认 `VITE_API_MODE=mock`。如需本地开发 API，显式设置 `VITE_API_MODE=real` 和 `VITE_API_BASE_URL`；real 请求失败不会静默回退至 Mock。

## 验证入口

```powershell
# 后端隔离测试与离线迁移渲染
Push-Location backend
python -B -m pytest -q -p no:cacheprovider
python -B -m alembic heads
python -B -m alembic upgrade head --sql
Pop-Location

# 前端质量检查
Push-Location frontend
npm.cmd run api:check
npm.cmd test
npm.cmd run lint
npm.cmd run build
Pop-Location
```

`npm.cmd run api:check` 只校验冻结 OpenAPI artifact 与生成 TypeScript 没有被意外改写。runtime API 需通过直接导入 `quant_trading.main.app` 的独立审计验证。

最近一次最小修复后的前端验证中，`api:check`、lint（有既有未使用变量警告）和 build 均成功；`npm.cmd test` 为 139 通过、0 失败，Research 与四路由无障碍 E2E 也通过。隔离 G2 已使用 token 专属 UTF-8 dataset probe 完成 source/restore、任务、制品与备份校验，且已清理全部 token 资源；详见恢复来源说明。这验证的是重建闭环，不应表述为完整生产发布验收。

`scripts/runtime_closeout.py` 只可在操作者明确提供隔离、名称含 `test` 或 `smoke` 的 PostgreSQL endpoint 时运行。它会创建和删除唯一临时 smoke 数据库与系统临时目录；不得对开发或生产数据库运行。

## 文档

- [文档索引](docs/README.md)
- [恢复来源说明](docs/RECOVERY_PROVENANCE.md)
- [对话与代码导出](docs/CONVERSATION_AND_CODE_EXPORT.md)
- [需求与规划](docs/SDLC_01_Requirements_Analysis_and_Planning.md)
- [系统设计](docs/SDLC_02_System_Design_Specification.md)
- [追踪矩阵与阶段门](docs/SDLC_03_Traceability_and_Gates.md)
- [ADR 索引](docs/adr/README.md)
