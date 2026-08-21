# Quantitative Trading Frontend

React + TypeScript + Vite 研究控制台。默认使用 Mock API；真实 API 模式已覆盖 B2 数据目录、不可变快照创建、任务观察、Manifest、质量运行和版本血缘。

## 本地运行

```powershell
npm.cmd ci
npm.cmd run dev
```

常用质量命令：

```powershell
npm.cmd run api:check
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

最近一次最小修复后的命令结果：`api:check`、lint（保留未使用变量警告）和 build 成功；`npm.cmd test` 为 139 通过、0 失败。Research E2E 与四路由无障碍扫描通过；隔离 G2 已使用 token 专属 UTF-8 dataset probe 完成 source/restore、任务、制品与备份校验并清理资源。该结果验证重建闭环，但不代表完整生产发布验收；详见根目录的恢复来源说明。

## Mock / Real API

复制 `.env.example` 为 `.env.local`，并按需要切换：

```dotenv
VITE_API_MODE=real
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_DEV_LOGIN_NAME=frontend-dev
```

real 模式仅用于 Vite development 环境。前端会调用 `POST /auth/dev-session` 建立当前角色的开发会话，再以 Bearer token 调用 `GET /auth/me` 校验登录名、角色和 scopes；校验通过后才缓存令牌。后端需先完成迁移、种子数据并在 `localhost:8000` 启动。

当前 real 范围：数据源目录、服务端筛选/分页的数据集与版本列表、数据集/版本详情，以及从数据集详情或版本列表创建快照。创建请求使用 `Idempotency-Key`，返回 202 后跳转版本详情并轮询版本与任务终态；终态页面只展示后端提供的资格判断、Manifest、哈希、质量运行和血缘。策略、实验、回测、任务中心和其余业务页面继续使用 Mock，real 请求失败时不会回退 Mock。

## OpenAPI → TypeScript

生成过程不依赖全局代码生成器。脚本以实际 `backend` 包根作为 `PYTHONPATH`，优先使用本地 `backend/.venv`（或 `PYTHON` 指定的解释器）导出兼容 artifact：

```powershell
npm.cmd run api:generate
npm.cmd run api:check
```

`api:generate` 会更新 `openapi.json` 与 `src/api/generated/schema.ts`，只能在明确更新冻结 artifact 时使用。`api:check` 不改文件，校验冻结 artifact compatibility export 与现有生成物一致；它不是 runtime OpenAPI 参数、请求/响应或安全 schema 的逐字段验证。若后端虚拟环境不在默认位置，可通过 `PYTHON` 指定解释器。
