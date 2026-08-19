/**
 * 策略与模型 Mock：注册表、版本与「基于冻结版本创建」。
 *
 * 数据模型：
 * - 注册表：Strategy / Model 注册项（含锁定状态、版本数、更新时间）；
 * - 版本：StrategyVersion / ModelVersion（草稿 / 已冻结 / 已废弃），
 *   仅 status === 'frozen' 的版本可作为新版本基准；
 * - 创建约束：基准须已冻结（SR-400）；注册表已锁定禁止创建（SR-409）。
 */

import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'

/** 版本冻结状态（draft / frozen / deprecated） */
export type VersionFreezeStatus = 'draft' | 'frozen' | 'deprecated'

/** 版本冻结状态中文标签（供 StatusTag label 覆盖） */
export const FREEZE_STATUS_LABEL: Record<VersionFreezeStatus, string> = {
  draft: '草稿',
  frozen: '已冻结',
  deprecated: '已废弃',
}

/** 模型类型（展示文案） */
export type ModelKind = '规则' | '统计' | '树模型' | '深度学习'

/** 配置快照（只读，创建新版本时整份继承） */
export interface ConfigSnapshot {
  /** 资产池 */
  universe: string
  /** 持仓数量 */
  topN: number
  /** 持有天数 */
  holdDays: number
  /** 止损阈值（%） */
  stopLoss: number
  /** 止盈阈值（%，可选） */
  takeProfit?: number
  /** 再平衡频率 */
  rebalance: string
  /** 预算（元） */
  budget: number
}

/** 信号规则（只读） */
export interface SignalRule {
  /** 指标名（如 MA_CROSS） */
  indicator: string
  /** 参数（展示用） */
  params: Record<string, string | number>
  /** 多空方向 */
  direction: '做多' | '做空' | '中性'
}

/** 策略注册项 */
export interface Strategy {
  id: string
  name: string
  description: string
  department: string
  /** 管理规模（元） */
  aum: number
  /** 注册版本数（聚合展示） */
  versionCount: number
  /** 注册表锁定：禁止创建新版本 */
  locked: boolean
  updatedAt: string
}

/** 模型注册项 */
export interface Model {
  id: string
  name: string
  kind: ModelKind
  description: string
  versionCount: number
  locked: boolean
  updatedAt: string
}

/** 策略版本 */
export interface StrategyVersion {
  id: string
  strategyId: string
  /** 版本号（v2 → 2） */
  version: number
  status: VersionFreezeStatus
  createdAt: string
  /** 冻结时间；未冻结为 null */
  frozenAt: string | null
  /** 父版本 ID；注册表基版本为 null */
  parentId: string | null
  snapshot: ConfigSnapshot
  signals: SignalRule[]
  note?: string
}

/** 模型适用范围 */
export interface ModelScope {
  /** 资产池 */
  universe: string
  /** 调仓频率 */
  rebalance: string
}

/** 模型版本 */
export interface ModelVersion {
  id: string
  modelId: string
  name: string
  kind: ModelKind
  /** 版本号（v1 → 1） */
  version: number
  /** 是否挑战层模型（需更高预算档） */
  challenge: boolean
  status: VersionFreezeStatus
  createdAt: string
  frozenAt: string | null
  parentId: string | null
  scope: ModelScope
  note?: string
}

/** 策略版本与模型版本的联合（列表 / 详情按 id 前缀分发） */
export type AnyVersion = StrategyVersion | ModelVersion

/** 模型 ID 以 'm-' 前缀区分（注册项与版本通用） */
export function isModelId(id: string): boolean {
  return id.startsWith('m-')
}

// ---------- Mock 数据 ----------

const MOCK_STRATEGY_REGISTRY: Strategy[] = [
  {
    id: 'st-momentum',
    name: '动量轮动',
    description: '双均线交叉择时，动量排序选股，持仓 5 只',
    department: '量化投资部',
    aum: 52_000_000,
    versionCount: 3,
    locked: false,
    updatedAt: '2026-08-05T14:22:00+08:00',
  },
  {
    id: 'st-lion',
    name: '价值低估轮动',
    description: '低估值因子筛选，季度再平衡',
    department: '基本面组',
    aum: 31_500_000,
    versionCount: 1,
    locked: false,
    updatedAt: '2026-06-20T11:00:00+08:00',
  },
  {
    id: 'st-thrust',
    name: '小市值优选',
    description: '三日强度排序，小市值优选取前 10',
    department: '量化投资部',
    aum: 18_000_000,
    versionCount: 1,
    locked: false,
    updatedAt: '2026-05-12T10:30:00+08:00',
  },
  {
    id: 'st-slope',
    name: '行业动量轮动',
    description: '行业指数动量斜率打分，轮动持仓',
    department: '行业研究组',
    aum: 24_000_000,
    versionCount: 1,
    locked: false,
    updatedAt: '2026-04-18T09:00:00+08:00',
  },
  {
    id: 'st-hedge',
    name: '对冲策略',
    description: '多因子中性对冲，剥离市场 Beta',
    department: '对冲组',
    aum: 60_000_000,
    versionCount: 1,
    locked: true,
    updatedAt: '2026-02-26T16:40:00+08:00',
  },
]

const MOCK_MODEL_REGISTRY: Model[] = [
  {
    id: 'm-buyhold',
    name: '买入持有',
    kind: '规则',
    description: '固定权重买入持有，作为基准对照',
    versionCount: 1,
    locked: false,
    updatedAt: '2026-01-15T09:30:00+08:00',
  },
  {
    id: 'm-linreg',
    name: '线性回归',
    kind: '统计',
    description: '多因子线性回归打分，截面选股',
    versionCount: 2,
    locked: false,
    updatedAt: '2026-07-28T15:10:00+08:00',
  },
  {
    id: 'm-lgbm',
    name: 'LightGBM',
    kind: '树模型',
    description: '梯度提升树，因子非线性组合',
    versionCount: 1,
    locked: false,
    updatedAt: '2026-06-01T14:00:00+08:00',
  },
  {
    id: 'm-xgb',
    name: 'XGBoost',
    kind: '树模型',
    description: '梯度提升树，特征重要性可解释',
    versionCount: 1,
    locked: false,
    updatedAt: '2026-06-02T10:20:00+08:00',
  },
  {
    id: 'm-lstm',
    name: 'LSTM',
    kind: '深度学习',
    description: '长短期记忆网络，时序特征建模',
    versionCount: 1,
    locked: true,
    updatedAt: '2026-03-10T13:45:00+08:00',
  },
]

const MOCK_STRATEGY_VERSIONS: StrategyVersion[] = [
  {
    id: 'st-momentum-v3',
    strategyId: 'st-momentum',
    version: 3,
    status: 'draft',
    createdAt: '2026-08-05T14:22:00+08:00',
    frozenAt: null,
    parentId: 'st-momentum-v2',
    snapshot: {
      universe: '沪深300',
      topN: 5,
      holdDays: 20,
      stopLoss: 8,
      takeProfit: 15,
      rebalance: '每 20 个交易日',
      budget: 50_000_000,
    },
    signals: [
      { indicator: 'MA_CROSS', params: { fast: 5, slow: 20 }, direction: '做多' },
      { indicator: 'MOM_RANK', params: { lookback: 60, topN: 5 }, direction: '做多' },
    ],
    note: '基于 v2 调整持仓数量与止损阈值',
  },
  {
    id: 'st-momentum-v2',
    strategyId: 'st-momentum',
    version: 2,
    status: 'frozen',
    createdAt: '2026-07-10T10:00:00+08:00',
    frozenAt: '2026-07-25T15:30:00+08:00',
    parentId: 'st-momentum-v1',
    snapshot: {
      universe: '沪深300',
      topN: 5,
      holdDays: 20,
      stopLoss: 8,
      takeProfit: 15,
      rebalance: '每 20 个交易日',
      budget: 50_000_000,
    },
    signals: [
      { indicator: 'MA_CROSS', params: { fast: 5, slow: 20 }, direction: '做多' },
      { indicator: 'MOM_RANK', params: { lookback: 60, topN: 5 }, direction: '做多' },
    ],
    note: '上线基线',
  },
  {
    id: 'st-momentum-v1',
    strategyId: 'st-momentum',
    version: 1,
    status: 'deprecated',
    createdAt: '2026-03-02T09:30:00+08:00',
    frozenAt: '2026-03-15T15:00:00+08:00',
    parentId: null,
    snapshot: {
      universe: '沪深300',
      topN: 10,
      holdDays: 10,
      stopLoss: 5,
      takeProfit: 10,
      rebalance: '每 10 个交易日',
      budget: 45_000_000,
    },
    signals: [{ indicator: 'MA_CROSS', params: { fast: 10, slow: 30 }, direction: '做多' }],
    note: '早期参数，回测超额衰减后废弃',
  },
  {
    id: 'st-lion-v1',
    strategyId: 'st-lion',
    version: 1,
    status: 'frozen',
    createdAt: '2026-06-20T11:00:00+08:00',
    frozenAt: '2026-06-25T16:00:00+08:00',
    parentId: null,
    snapshot: {
      universe: '中证500',
      topN: 8,
      holdDays: 60,
      stopLoss: 10,
      rebalance: '每季度',
      budget: 30_000_000,
    },
    signals: [
      { indicator: 'VALUE_RANK', params: { factor: 'pe_ttm,pb', lookback: 250, topN: 8 }, direction: '做多' },
    ],
    note: '上线基线',
  },
  {
    id: 'st-thrust-v1',
    strategyId: 'st-thrust',
    version: 1,
    status: 'frozen',
    createdAt: '2026-05-12T10:30:00+08:00',
    frozenAt: '2026-05-18T14:00:00+08:00',
    parentId: null,
    snapshot: {
      universe: '全市场',
      topN: 10,
      holdDays: 5,
      stopLoss: 8,
      rebalance: '每 5 个交易日',
      budget: 18_000_000,
    },
    signals: [{ indicator: 'THRUST_3D', params: { lookback: 3, topN: 10 }, direction: '做多' }],
    note: '上线基线',
  },
  {
    id: 'st-slope-v1',
    strategyId: 'st-slope',
    version: 1,
    status: 'frozen',
    createdAt: '2026-04-18T09:00:00+08:00',
    frozenAt: '2026-04-24T17:00:00+08:00',
    parentId: null,
    snapshot: {
      universe: '沪深300',
      topN: 4,
      holdDays: 20,
      stopLoss: 8,
      takeProfit: 15,
      rebalance: '每 20 个交易日',
      budget: 24_000_000,
    },
    signals: [{ indicator: 'SLOPE_SCORE', params: { window: 20, topN: 4 }, direction: '中性' }],
    note: '上线基线',
  },
  {
    id: 'st-hedge-v1',
    strategyId: 'st-hedge',
    version: 1,
    status: 'frozen',
    createdAt: '2026-02-26T16:40:00+08:00',
    frozenAt: '2026-03-02T10:00:00+08:00',
    parentId: null,
    snapshot: {
      universe: '全市场',
      topN: 20,
      holdDays: 20,
      stopLoss: 6,
      rebalance: '每周',
      budget: 60_000_000,
    },
    signals: [{ indicator: 'FACTOR_NEUTRAL', params: { beta: 0.1, factor: 'ic_weight' }, direction: '中性' }],
    note: '注册表锁定，禁止新建版本',
  },
]

const MOCK_MODELS: ModelVersion[] = [
  {
    id: 'm-buyhold-v1',
    modelId: 'm-buyhold',
    name: '买入持有',
    kind: '规则',
    version: 1,
    challenge: false,
    status: 'frozen',
    createdAt: '2026-01-15T09:30:00+08:00',
    frozenAt: '2026-01-20T15:00:00+08:00',
    parentId: null,
    scope: { universe: '全市场', rebalance: '月度' },
    note: '基准对照',
  },
  {
    id: 'm-linreg-v2',
    modelId: 'm-linreg',
    name: '线性回归',
    kind: '统计',
    version: 2,
    challenge: false,
    status: 'draft',
    createdAt: '2026-07-28T15:10:00+08:00',
    frozenAt: null,
    parentId: 'm-linreg-v1',
    scope: { universe: '沪深300', rebalance: '每周' },
    note: '增加因子 IC 加权',
  },
  {
    id: 'm-linreg-v1',
    modelId: 'm-linreg',
    name: '线性回归',
    kind: '统计',
    version: 1,
    challenge: false,
    status: 'frozen',
    createdAt: '2026-01-10T11:00:00+08:00',
    frozenAt: '2026-01-16T14:00:00+08:00',
    parentId: null,
    scope: { universe: '沪深300', rebalance: '每周' },
    note: '上线基线',
  },
  {
    id: 'm-lgbm-v1',
    modelId: 'm-lgbm',
    name: 'LightGBM',
    kind: '树模型',
    version: 1,
    challenge: false,
    status: 'frozen',
    createdAt: '2026-06-01T14:00:00+08:00',
    frozenAt: '2026-06-05T16:30:00+08:00',
    parentId: null,
    scope: { universe: '中证500', rebalance: '每周' },
    note: '上线基线',
  },
  {
    id: 'm-xgb-v1',
    modelId: 'm-xgb',
    name: 'XGBoost',
    kind: '树模型',
    version: 1,
    challenge: false,
    status: 'frozen',
    createdAt: '2026-06-02T10:20:00+08:00',
    frozenAt: '2026-06-06T11:00:00+08:00',
    parentId: null,
    scope: { universe: '中证500', rebalance: '每周' },
    note: '上线基线',
  },
  {
    id: 'm-lstm-v1',
    modelId: 'm-lstm',
    name: 'LSTM',
    kind: '深度学习',
    version: 1,
    challenge: true,
    status: 'frozen',
    createdAt: '2026-03-10T13:45:00+08:00',
    frozenAt: '2026-03-14T15:20:00+08:00',
    parentId: null,
    scope: { universe: '全市场', rebalance: '每日' },
    note: '挑战层模型，注册表锁定',
  },
]

// ---------- 查询函数 ----------

function copyStrategyVersion(v: StrategyVersion): StrategyVersion {
  return {
    ...v,
    snapshot: { ...v.snapshot },
    signals: v.signals.map((s) => ({ ...s, params: { ...s.params } })),
  }
}

function copyModelVersion(v: ModelVersion): ModelVersion {
  return { ...v, scope: { ...v.scope } }
}

/** 查询策略注册表 */
export function listStrategies(options?: MockRequestOptions): Promise<Strategy[]> {
  return mockRequest(() => MOCK_STRATEGY_REGISTRY.map((s) => ({ ...s })), options)
}

/** 查询模型注册表 */
export function listModels(options?: MockRequestOptions): Promise<Model[]> {
  return mockRequest(() => MOCK_MODEL_REGISTRY.map((m) => ({ ...m })), options)
}

/** 查询单个策略注册项 */
export function getStrategy(id: string, options?: MockRequestOptions): Promise<Strategy> {
  return mockRequest(
    () => {
      const item = MOCK_STRATEGY_REGISTRY.find((s) => s.id === id)
      if (!item) {
        throw new ApiError({
          code: 'IR-0404',
          message: `策略不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      return { ...item }
    },
    options,
  )
}

/** 查询单个模型注册项 */
export function getModel(id: string, options?: MockRequestOptions): Promise<Model> {
  return mockRequest(
    () => {
      const item = MOCK_MODEL_REGISTRY.find((m) => m.id === id)
      if (!item) {
        throw new ApiError({
          code: 'IR-0404',
          message: `模型不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      return { ...item }
    },
    options,
  )
}

/** 查询某策略下的版本列表（按版本号降序） */
export function listStrategyVersions(
  strategyId: string,
  options?: MockRequestOptions,
): Promise<StrategyVersion[]> {
  return mockRequest(
    () =>
      MOCK_STRATEGY_VERSIONS.filter((v) => v.strategyId === strategyId)
        .sort((a, b) => b.version - a.version)
        .map(copyStrategyVersion),
    options,
  )
}

/** 查询某模型下的版本列表（按版本号降序） */
export function listModelVersions(
  modelId: string,
  options?: MockRequestOptions,
): Promise<ModelVersion[]> {
  return mockRequest(
    () =>
      MOCK_MODELS.filter((v) => v.modelId === modelId)
        .sort((a, b) => b.version - a.version)
        .map(copyModelVersion),
    options,
  )
}

/** 按归属 ID 查询版本列表（模型用 'm-' 前缀区分） */
export function listVersions(
  ownerId: string,
  options?: MockRequestOptions,
): Promise<AnyVersion[]> {
  return isModelId(ownerId)
    ? listModelVersions(ownerId, options)
    : listStrategyVersions(ownerId, options)
}

/** 查询单个策略版本 */
export function getStrategyVersion(
  id: string,
  options?: MockRequestOptions,
): Promise<StrategyVersion> {
  return mockRequest(
    () => {
      const version = MOCK_STRATEGY_VERSIONS.find((v) => v.id === id)
      if (!version) {
        throw new ApiError({
          code: 'IR-0404',
          message: `策略版本不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      return copyStrategyVersion(version)
    },
    options,
  )
}

/** 查询单个模型版本 */
export function getModelVersion(
  id: string,
  options?: MockRequestOptions,
): Promise<ModelVersion> {
  return mockRequest(
    () => {
      const model = MOCK_MODELS.find((m) => m.id === id)
      if (!model) {
        throw new ApiError({
          code: 'IR-0404',
          message: `模型版本不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      return copyModelVersion(model)
    },
    options,
  )
}

// ---------- 创建 ----------

export interface CreateVersionInput {
  kind: 'strategy' | 'model'
  /** 基准版本 ID（须为已冻结） */
  sourceId: string
}

let auditSeq = 1

/** 生成 mock 审计编号，如 AUD-20260808-0001（与确认弹窗同构，避免跨层依赖） */
function generateAuditId(date = new Date()): string {
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  return `AUD-${ymd}-${String(auditSeq++).padStart(4, '0')}`
}

/**
 * 基于已冻结版本创建新版本（草稿）：
 * - 基准须已冻结，否则 SR-400；
 * - 归属注册表已锁定，则 SR-409；
 * - 新版本继承基准的配置快照 / 信号 / 适用范围，parentId 指向基准。
 */
export function createVersionBasedOn(
  input: CreateVersionInput,
  options?: MockRequestOptions,
): Promise<{ version: AnyVersion; auditId: string }> {
  return mockRequest(() => {
    const { kind, sourceId } = input
    const source =
      kind === 'strategy'
        ? MOCK_STRATEGY_VERSIONS.find((v) => v.id === sourceId)
        : MOCK_MODELS.find((v) => v.id === sourceId)
    if (!source) {
      throw new ApiError({
        code: 'IR-0404',
        message: `${kind === 'strategy' ? '策略' : '模型'}版本不存在：${sourceId}`,
        requestId: generateRequestId(),
      })
    }
    if (source.status !== 'frozen') {
      throw new ApiError({
        code: 'SR-400',
        message: '仅已冻结版本可作为新版本基准',
        requestId: generateRequestId(),
      })
    }

    const ownerId =
      kind === 'strategy'
        ? (source as StrategyVersion).strategyId
        : (source as ModelVersion).modelId
    const registryLocked =
      kind === 'strategy'
        ? MOCK_STRATEGY_REGISTRY.find((r) => r.id === ownerId)?.locked
        : MOCK_MODEL_REGISTRY.find((r) => r.id === ownerId)?.locked
    if (registryLocked) {
      throw new ApiError({
        code: 'SR-409',
        message: '注册表已锁定，禁止创建新版本',
        requestId: generateRequestId(),
      })
    }

    const siblings =
      kind === 'strategy'
        ? MOCK_STRATEGY_VERSIONS.filter((v) => v.strategyId === ownerId)
        : MOCK_MODELS.filter((v) => v.modelId === ownerId)
    const nextVersion = Math.max(0, ...siblings.map((v) => v.version)) + 1
    const now = new Date().toISOString()
    const newId = `${ownerId}-v${nextVersion}`

    let version: AnyVersion
    if (kind === 'strategy') {
      const src = source as StrategyVersion
      version = {
        id: newId,
        strategyId: ownerId,
        version: nextVersion,
        status: 'draft',
        createdAt: now,
        frozenAt: null,
        parentId: src.id,
        snapshot: { ...src.snapshot },
        signals: src.signals.map((s) => ({ ...s, params: { ...s.params } })),
        note: '基于已冻结版本创建的新草稿',
      }
      MOCK_STRATEGY_VERSIONS.push(version)
    } else {
      const src = source as ModelVersion
      version = {
        id: newId,
        modelId: ownerId,
        name: src.name,
        kind: src.kind,
        version: nextVersion,
        challenge: src.challenge,
        status: 'draft',
        createdAt: now,
        frozenAt: null,
        parentId: src.id,
        scope: { ...src.scope },
        note: '基于已冻结版本创建的新草稿',
      }
      MOCK_MODELS.push(version)
    }

    const registry =
      kind === 'strategy'
        ? MOCK_STRATEGY_REGISTRY.find((r) => r.id === ownerId)
        : MOCK_MODEL_REGISTRY.find((r) => r.id === ownerId)
    if (registry) {
      registry.versionCount += 1
      registry.updatedAt = now
    }

    return { version: { ...version }, auditId: generateAuditId() }
  }, options)
}

/** 冻结策略草稿版本。 */
export function freezeStrategyVersion(
  id: string,
  reason: string,
  options?: MockRequestOptions,
): Promise<{ version: StrategyVersion; auditId: string }> {
  return mockRequest(
    () => {
      const version = MOCK_STRATEGY_VERSIONS.find((v) => v.id === id)
      if (!version) {
        throw new ApiError({
          code: 'IR-0404',
          message: `策略版本不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      if (version.status !== 'draft') {
        throw new ApiError({
          code: 'SR-409',
          message: '只有草稿策略版本可以冻结',
          requestId: generateRequestId(),
        })
      }
      if (!reason.trim()) {
        throw new ApiError({
          code: 'SR-400',
          message: '冻结操作必须填写原因',
          requestId: generateRequestId(),
        })
      }
      version.status = 'frozen'
      version.frozenAt = new Date().toISOString()
      return { version: copyStrategyVersion(version), auditId: generateAuditId() }
    },
    options,
  )
}

/** 冻结模型草稿版本。 */
export function freezeModelVersion(
  id: string,
  reason: string,
  options?: MockRequestOptions,
): Promise<{ version: ModelVersion; auditId: string }> {
  return mockRequest(
    () => {
      const version = MOCK_MODELS.find((v) => v.id === id)
      if (!version) {
        throw new ApiError({
          code: 'IR-0404',
          message: `模型版本不存在：${id}`,
          requestId: generateRequestId(),
        })
      }
      if (version.status !== 'draft') {
        throw new ApiError({
          code: 'SR-409',
          message: '只有草稿模型版本可以冻结',
          requestId: generateRequestId(),
        })
      }
      if (!reason.trim()) {
        throw new ApiError({
          code: 'SR-400',
          message: '冻结操作必须填写原因',
          requestId: generateRequestId(),
        })
      }
      version.status = 'frozen'
      version.frozenAt = new Date().toISOString()
      return { version: copyModelVersion(version), auditId: generateAuditId() }
    },
    options,
  )
}
