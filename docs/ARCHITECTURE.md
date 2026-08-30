# 架构说明文档（ARCHITECTURE.md）

> 范围：`engine/` TypeScript 回测内核（P0-P2 全部九项任务的最终架构）。
> 本文档面向后续维护者：理解模块职责、依赖方向、关键设计决策与扩展方式。

---

## 1. 仓库全景与引擎定位

本仓库包含三个互相独立的部分：

```text
frontend/          React 19 + Vite 管理控制台（TypeScript，纯 UI）
backend/           Python 3.12 + FastAPI 数据/审计后端（本次未改动）
engine/            TypeScript 回测内核（本阶段新建，策略计算核心）
```

`engine/` 是一个零运行时依赖的纯计算库（`@quant-trading/engine`，仅 devDeps：
typescript / vitest / @vitest / @types/node），负责从原始 K 线到绩效报告的
完整策略验证链路。它与 `backend/` 的关系是**平行技术栈**：Python 侧做数据管理
与审计闭环，TS 侧做策略计算；后续如需打通，在 Worker 中以子进程/HTTP 调用
`engine` 即可，无需改动其任何内部结构。

## 2. 设计目标

| 目标 | 落地机制 |
|---|---|
| 回测结果可信 | 成本/风控全配置化；成交边界确定性舍入；全链路审计（订单日志、风控事件） |
| 实验可复现 | 实验 ID + 参数/配置/数据指纹/环境快照 + 结果指纹比对回放 |
| 数据质量保障 | 质量流水线输出逐条 issue 的诊断报告，坏数据无法静默进入引擎 |
| 策略可扩展 | 工厂式插件 SDK（生命周期 + 注册表 + 动态 ES 模块加载） |
| 确定性 | canonical JSON（递归键排序）、epoch ms 时间戳、无墙钟/随机数参与计算 |

## 3. 模块划分与依赖方向

```text
src/
  core/           原语层：Bar/Order/Fill/Position 类型、money 舍入、错误体系
    ^
  cost/           P0-1 交易成本模型（StandardCostModel）
  execution/      P0-1 成交环节（ExecutionService）+ 账本（Portfolio）
    ^
  risk/           P0-2 风控中间层（RiskManager）
  engine/         P0-2 回测主循环（runBacktest + BacktestStrategy 接缝）
    ^
  data-quality/   P0-3 数据质量流水线（validateSeries/validateDataset）
  experiment/     P0-4 实验可复现（runExperiment/reproduceExperiment/store）
  metrics/        P1-5 绩效看板（computePerformance/trade 配对/回撤序列）
  compare/        P1-6 多策略对比（compareStrategies + Markdown 渲染）
  paper/          P1-7 模拟盘执行层（PaperBroker + 六态订单状态机）
  strategy/       P2-8 插件 SDK（registry/runner/示例模板 sma-crossover）
```

**依赖规则**（单向，无环）：

- `core` 被所有人依赖，不依赖任何人；
- `cost`/`execution`/`risk` 互相独立，仅依赖 `core`；
- `engine` 组合 `cost`+`execution`+`risk`；
- `metrics`/`compare`/`paper`/`experiment`/`strategy` 只依赖 `engine` 及其下游；
- 上层模块永远不知道下层模块的存在（`index.ts` 是唯一公共出口）。

## 4. 核心数据流

```text
原始 K 线 (RawBar[])
      │  validateDataset：时区归一/去重/缺失检测/异常值标记 → 诊断报告
      v
干净 Bar[] ─────────────────────────────────────────────┐
      │                                                  │
      │  runBacktest（每个 (timestamp, symbol) bar）      │
      v                                                  │
  strategy.onBar(ctx)  ──产生──>  Order[]                │
      │                                   │               │
      │                          risk.checkOrder          │
      │                     （止损/仓位/熔断/回撤门卫）    │
      │                                   │               │
      │                          execution.execute        │
      │                    （滑点 → 手数 → 手续费 → 校验） │
      │                                   │               │
      │                          portfolio.applyFill      │
      │                                   │               │
      │             收盘：mark equity → stop-loss 强平     │
      │                  → daily-loss / drawdown 熔断      │
      v                                   v               v
BacktestResult { equityCurve, fills, riskEvents, orderLog, finalPortfolio }
      │                                                  │
      ├── computePerformance → 六项指标 + 净值/回撤曲线    │
      ├── compareStrategies    → A/B 对比矩阵 + Markdown  │
      └── runExperiment        → ExperimentRecord +      ─┘
                               数据指纹/结果指纹 → 复现回放
```

模拟盘（`PaperBroker`）复用同一成本模型与账本，以 `onPrice` 事件驱动六态
订单状态机（created → submitted → partially_filled → filled/cancelled/rejected），
其成交明细可直接喂给 `computePerformance` 与回测结果同台对比。

## 5. 关键设计决策与权衡

1. **金额边界确定性舍入**：所有 notional/手续费/滑点成本经 `roundTo`（epsilon
   守护的半 away-from-zero），时间戳统一 epoch ms（UTC）。同一实验双跑结果
   逐位相同，是"结果指纹相等 = 复现忠实"的前提。
2. **canonical JSON + SHA-256**：`JSON.stringify` 的键序依赖插入顺序，不可作
   为哈希输入。`experiment/canonical.ts` 递归排序键、按 JSON 语义丢弃
   undefined 值、对非 JSON 值显式抛错——杜绝静默不一致。
3. **执行器与账本分离**：`ExecutionService` 只做校验与 Fill 归因，不修改
   `Portfolio`；`Portfolio.applyFill` 只做记账。两者独立测试，风控插入点
   （order 提交前）与强平点（收盘后）也因此清晰。
4. **风控即审计**：每次触发产出 `RiskEvent`（code/action/symbol/detail），
   订单日志记录 requested→submitted→outcome 全程；"为什么没成交"永远可回答。
5. **数据流水线只标记不静默修复**：结构性错误（OHLC 违例）剔除并报 error；
   可疑但合理的数据（价格跳变、零成交量）保留并报 warning；是否阻断由调用方
   根据 `status` 决定。
6. **工厂式插件**：`create(params)` 返回闭包实例，实例状态不落在插件对象上，
   同一插件多实例并行绝不互相污染；teardown 经 runner `try/finally` 保证，
   幂等且在报错路径同样执行。
7. **纯类型模块不参与覆盖率**：`vitest.config.ts` 排除纯类型声明文件
   （`types.ts`、`strategy/strategy.ts`），避免零运行时代码拉低统计失真。

## 6. 测试策略

- **工具链**：vitest + @vitest/coverage-v8，全局阈值 80%（实际 97.07%）。
- **层次**：原子单元（money/cost/risk 各规则）→ 集成（引擎主循环场景）→
  端到端（数据流水线 → 回测 → 绩效；run → store → load → reproduce）。
- **精确核算**：关键测试手工推导期望值（如 FIFO 部分成交费用分摊
  1225.5、SMA 模板金叉/死叉时点、风控触发边界 95_000 vs 94_999）。
- **确定性回归**：每个有状态模块都有"同输入双跑深度相等"测试。
- 运行：`cd engine && npm run test:coverage`（或 `npm test` 快速跑）。

## 7. 扩展指南

**新增策略**：复制 `src/strategy/plugins/sma-crossover.ts`，改 `id`、参数
类型与 `create` 内的信号逻辑；`registry.register(plugin)` 后即可
`runPluginBacktest` / 动态模块加载。参数必须保持 JSON 可序列化。

**新增成本/风控规则**：成本模型实现 `CostModel` 接口注入 `ExecutionService`；
风控规则扩展 `RiskLimits` + `RiskManager.checkOrder/evaluateExits/evaluateLimits`
（保持"决策与执行分离"，规则本身不碰账本）。

**持久化实验**：`serializeRun`/`deserializeRun` 已提供 JSON 无损往返，
实现一个落盘的 `ExperimentStore` 即可（接口仅 save/load/list 三个方法）。

## 8. 已知限制与后续方向

- 成交价策略目前仅 `bar_close`（P0 撮合语义）；next_open 等需扩展
  `ExecutionConfig.fillPolicy`。
- 风控检查基于收盘价快照，盘中路径依赖（tick 级止损）需要事件级回测循环。
- `ExperimentStore` 目前仅有内存实现；数据指纹校验要求复现方持有同一数据集。
- 多品种间的资金分配、做空（负仓位）、分红除权尚未建模。
- 引擎与 Python 后端/API 的桥接（Worker 子进程或 HTTP）留待集成阶段。

---

*文档对应代码版本：engine v0.1.0（commits 37adf32…f0ccc9c，203 tests）。*
