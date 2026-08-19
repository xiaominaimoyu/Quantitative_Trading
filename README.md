# Quantitative Trading

> **面向A股日线研究的可审计、可复现量化研究平台**

---

## 📖 项目介绍

### 项目概述

Quantitative Trading Platform 是一个专为A股日线研究设计的量化研究平台，核心目标是实现**可审计性**和**可复现性**。平台不是实盘系统，也不提供收益保证。

### 核心特性

#### 🔍 可审计性
- **完整的审计日志记录**：所有敏感操作均有迹可循
- **操作追踪与历史记录**：状态变更、数据修改全程记录
- **RBAC权限控制**：基于角色的精细化权限管理
- **数据血缘追踪**：数据从采集到使用的完整链路

#### 🔄 可复现性
- **不可变数据快照**：Parquet格式存储，SHA256校验
- **Manifest质量门控**：数据质量自动化验证
- **确定性测试环境**：Mock/Real双模式切换
- **版本管理**：策略、模型、风险规则版本控制

#### 📊 业务验收
- **G3/G4业务验收流程**：完整的验收报告、检查项、签字流程
- **DFX验证**：性能、可靠性、安全性自动化测试
- **一键部署**：PowerShell脚本一键启动/停止

### 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React 19)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Dashboard │ │Strategies│ │  Models  │ │ Datasets │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Experim.  │ │   Runs   │ │   Risk   │ │  Audit   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (FastAPI)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              API v1 Endpoints                         │   │
│  │ /datasets /strategies /models /risk /experiments     │   │
│  │ /runs /acceptance/reports /acceptance/checklists     │   │
│  │ /acceptance/dfx                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Services Layer                           │   │
│  │ AcceptanceReportService / ChecklistService           │   │
│  │ IssueService / SignatureService / DFXService         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Data Models                              │   │
│  │ User / AcceptanceReport / ChecklistItem              │   │
│  │ Issue / Signature / TestResult                       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL + DuckDB                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │PostgreSQL│ │  DuckDB  │ │  Worker  │                     │
│  │(业务数据) │ │(快照/不可变)│ │(后台任务)│                     │
│  └──────────┘ └──────────┘ └──────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

#### 前端
| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19.2.8 | UI框架 |
| TypeScript | 6.0 | 类型安全 |
| Vite | 8.2.0 | 构建工具 |
| Ant Design | 6.5.4 | UI组件库 |
| ECharts | 6.1.0 | 数据可视化 |
| React Router | 8.3.0 | 路由管理 |

#### 后端
| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.12+ | 核心语言 |
| FastAPI | 0.141.1 | Web框架 |
| SQLAlchemy | 2.0.52 | ORM |
| PostgreSQL | 17 | 主数据库 |
| Alembic | 1.19.1 | 数据库迁移 |
| Pydantic | 2.13.4 | 数据验证 |

#### 基础设施
| 技术 | 用途 |
|------|------|
| Docker / Docker Compose | 容器化部署 |
| PostgreSQL | 数据持久化 |
| DuckDB | 不可变快照存储 |

### 阶段完成状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| **G1 需求基线** | ✅ 已批准 | 2026-08-09 |
| **G2 系统设计** | ✅ 有条件批准 | 本机研究MVP范围 |
| **B0/B1 最小平台** | ✅ 已验收 | API、PostgreSQL、Worker |
| **B2 数据快照** | ✅ 已验收 | 快照、Manifest、质量门、血缘 |
| **B3 策略/模型/风险** | ✅ 已验收 | 版本管理、权限/审计 |
| **B4 实验/回测** | ✅ 已验收 | 实验、回测、任务控制 |
| **B5 验证/报告/审计** | ✅ 已验收 | 验证、报告、审计日志 |
| **B6 全真实切换** | ✅ 已验收 | CI、备份、SBOM |
| **G3/G4 业务验收** | ✅ 已验收 | 2026-08-19 |

---

## 当前状态

| 范围 | 状态 |
|---|---|
| B0/B1 API、PostgreSQL、Worker、artifact、OpenAPI/前端联调 | 技术链路已实现并有 2026-08-09 验收快照 |
| B2 不可变快照、Manifest、质量门、血缘、DuckDB、数据域 real UI | 两项技术退出条件已通过 |
| B2.1 基线收口 | 已验收；根提交 `b30f471`，详见执行包证据 |
| G1 需求基线 / G2 系统设计 | G1 已批准；G2 已有条件批准进入 B3，仅限本机研究 MVP 设计范围 |
| B3 策略/模型/风险版本、权限/审计和三域 real UI | 技术退出条件已通过；基线锚点为 `b3-baseline` |
| B4 实验、回测、任务控制 | 技术退出条件已通过；基线锚点为 `b4-baseline`；详见 [B4 实施证据](docs/B4_Implementation_Evidence.md) |
| B5 验证、报告与审计 | 技术退出条件已通过；基线锚点为 `b5-baseline`；详见 [B5 实施证据](docs/B5_Implementation_Evidence.md) |
| B6 全真实切换、CI、备份与 SBOM | 技术退出条件已通过；基线锚点为 `b6-baseline`；详见 [B6 实施证据](docs/B6_Implementation_Evidence.md) |
| G3/G4 业务验收 | 已实现；基线锚点为 `g3g4-baseline`；详见 [G3/G4 实施证据](docs/G3G4_Implementation_Evidence.md) |
| AI 助手、模拟盘、实盘 | 不在当前实现范围；实盘明确未授权 |

权威状态与证据见 [B2 实施证据](docs/B2_Implementation_Evidence.md)、[B2.1 基线收口执行包](docs/B2_1_Baseline_Closeout.md)、[B3 实施证据](docs/B3_Implementation_Evidence.md)、[B4 实施证据](docs/B4_Implementation_Evidence.md)、[G1/G2 执行包](docs/G1_G2_Execution_Package.md)、[ADR 索引](docs/adr/README.md)和 [SDLC 阶段门](docs/SDLC_03_Traceability_and_Gates.md)。历史收口文件是对应日期的证据快照，不代表其后的生产能力已经实现。

## 开发环境

当前实证基线为 Windows 11、Python 3.12、Node.js 24、npm 和 Docker Desktop。`backend/pyproject.toml` 允许 Python 3.12 及以上；Python 3.13 仍需单独兼容性复验。完整浏览器收口还需要 Microsoft Edge，且端口 `5432`、`8000`、`5173` 可用。

根目录 `docker-compose.yml` 只启动开发 PostgreSQL，不是生产编排。默认口令仅用于本机开发；远程或生产环境必须使用正式认证、密钥管理、HTTPS 和独立部署评审。

## 从空环境启动

以下命令均从仓库根目录执行。

```powershell
# 1. 启动开发数据库
docker compose up -d postgres

# 2. 创建后端环境并按锁文件安装
py -3.12 -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
.\backend\.venv\Scripts\python.exe -m pip install --no-deps -e backend
Copy-Item backend\.env.example backend\.env

# 3. 安装前端依赖
Push-Location frontend
npm.cmd ci
Copy-Item .env.example .env.local
Pop-Location

# 4. 执行迁移并写入开发种子
Push-Location backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m quant_trading.seed
Pop-Location
```

分别打开三个终端启动 API、Worker 和前端：

```powershell
# 终端 1：API
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn quant_trading.main:app --reload --port 8000
```

```powershell
# 终端 2：Worker
Set-Location backend
.\.venv\Scripts\python.exe -m quant_trading.worker
```

```powershell
# 终端 3：前端 Mock 模式（默认）
Set-Location frontend
npm.cmd run dev
```

B2/B3 真实域联调时，将终端 3 改为 real 模式：

```powershell
Set-Location frontend
$env:VITE_API_MODE='real'
$env:VITE_API_BASE_URL='http://localhost:8000/api/v1'
npm.cmd run dev
```

API 文档位于 `http://localhost:8000/api/docs`，前端位于 `http://localhost:5173`。

## 验收命令

先确保 PostgreSQL 已启动。完整 B2 本地收口会创建并删除唯一的临时测试数据库和临时文件，要求 API/Vite 端口空闲：

```powershell
.\backend\.venv\Scripts\python.exe scripts\runtime_closeout.py
```

其余常用检查：

```powershell
# 前端契约、测试、静态检查和两种模式构建
Push-Location frontend
npm.cmd run api:check
npm.cmd test
npm.cmd run lint
npm.cmd run build
$env:VITE_API_MODE='real'
npm.cmd run build
Pop-Location

# 有界容量入口；--baseline 追加确定性全行性能工作负载，不等同于生产回测
.\backend\.venv\Scripts\python.exe scripts\b2_capacity_probe.py --rows 100000 --batch-rows 50000 --baseline
```

强制 PostgreSQL 后端测试需要预先存在名称含 `test` 或 `smoke` 的专用数据库；禁止指向开发或生产业务库：

```powershell
$env:QUANT_REQUIRE_POSTGRES='1'
$env:QUANT_TEST_DATABASE_URL='postgresql+psycopg://quant:quant_dev_password@127.0.0.1:5432/quant_trading_test'
Push-Location backend
.\.venv\Scripts\python.exe -m pytest -o addopts='' -q
Pop-Location
```

## Mock / Real 边界

- Mock 是前端离线开发和 B4+ 尚未实现页面的夹具，不是后端成功证据。
- real 模式当前覆盖开发会话、B2 数据域，以及 B3 策略、模型和风险规则的目录、版本、冻结/停用、权限和审计交互。
- 实验、运行、回测、订单/账本、验证、报告、完整任务中心和系统运维等页面尚未形成 B4—B6 真实业务闭环；real 模式会明确禁用对应未实现能力。
- real 请求失败时不得静默回退 Mock；未知或未实现任务也不得被表示为成功。
- `deterministic_fixture` 只用于 development/test，不能替代正式数据供应商、许可和复权口径决策。

## 依赖锁维护

正常安装应使用 `backend/requirements.lock`。只有在明确升级依赖时才重新解析 `backend[dev]`，运行测试并审查锁文件差异。重生成命令在 `backend` 目录执行：

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pip freeze --exclude-editable | Sort-Object | Set-Content -Encoding utf8 requirements.lock
```

随后从根目录重新验证锁定安装：

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
.\backend\.venv\Scripts\python.exe -m pip install --no-deps -e backend
```

## 文档入口

- [需求与项目规划](docs/SDLC_01_Requirements_Analysis_and_Planning.md)
- [系统设计](docs/SDLC_02_System_Design_Specification.md)
- [追踪矩阵与阶段门](docs/SDLC_03_Traceability_and_Gates.md)
- [G1/G2 执行包](docs/G1_G2_Execution_Package.md)
- [G1 决策记录](docs/G1_Decision_Record.md)
- [G2 阶段门验收](docs/G2_Stage_Gate_Acceptance.md)
- [ADR 索引](docs/adr/README.md)
- [G2 平台与安全 PoC 证据](docs/G2_Technical_PoC_Evidence.md)
- [B3—B6 重新估算](docs/G2_B3_B6_Reestimate.md)
- [后端开发计划](docs/Backend_Development_Plan.md)
- [前端设计](docs/Frontend_Design.md)
- [B2 数据合同](docs/B2_Data_Snapshot_and_Quality.md)
- [B3 实施证据](docs/B3_Implementation_Evidence.md)
- [B4 实施证据](docs/B4_Implementation_Evidence.md)
- [B5 实施证据](docs/B5_Implementation_Evidence.md)
- [B6 实施证据](docs/B6_Implementation_Evidence.md)
