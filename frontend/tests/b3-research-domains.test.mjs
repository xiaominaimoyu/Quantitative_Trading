import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

import {
  mapStrategy,
  mapStrategyVersion,
} from '../src/api/strategies/mapper.ts'
import {
  createStrategy,
  createStrategyVersion,
  deprecateStrategyVersion,
  freezeStrategyVersion,
} from '../src/api/strategies/real.ts'
import { mapModel, mapModelVersion } from '../src/api/models/mapper.ts'
import {
  createModel,
  createModelVersion,
  deprecateModelVersion,
  freezeModelVersion,
} from '../src/api/models/real.ts'
import {
  mapRiskRuleSet,
  mapRiskRuleVersion,
} from '../src/api/risk/mapper.ts'
import {
  createRiskRuleSet,
  createRiskRuleVersion,
  deprecateRiskRuleVersion,
  freezeRiskRuleVersion,
} from '../src/api/risk/real.ts'
import {
  B3_ROLE_SCOPES,
  canManageOwnedResource,
} from '../src/app/researchPermissions.ts'
import { ApiError } from '../src/api/client.ts'
import { isForbiddenError } from '../src/api/research/ui.ts'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strategyId = 'ee1c9959-42a6-4384-b268-a44ad53b7cf2'
const strategyVersionId = '52964104-b3a5-48cb-b294-b642cda0eea8'
const modelId = '630a16f1-a9e3-4a2e-b725-ec057f5cdd39'
const modelVersionId = '1308971d-f886-40e9-8471-b890d978e6e1'
const riskId = '09663935-1432-4cdc-aa1c-53f65c9a1551'
const riskVersionId = 'c20aa34a-4cb5-46cb-af09-228bef4c0770'

const strategyContent = {
  contract_version: 'cross_sectional_momentum_v1',
  strategy_kind: 'cross_sectional_momentum',
  universe: 'csi300_point_in_time',
  frequency: 'daily',
  signal_price: 'close',
  signal_adjustment: 'backward',
  lookback_trading_days: 60,
  select_top_n: 20,
  rebalance_every_trading_days: 20,
  weighting: 'equal_weight',
  long_only: true,
  decision_timing: 'after_close',
  earliest_execution: 'next_open',
  output_contract: 'target_weights_v1',
}

const modelContent = {
  contract_version: 'no_prediction_baseline_v1',
  model_kind: 'no_prediction',
  purpose: 'baseline_reference',
  universe: 'csi300_point_in_time',
  frequency: 'daily',
  requires_training: false,
  randomized: false,
  prediction_horizon_trading_days: null,
  artifact_required: false,
  implementation_ref: 'no_prediction_baseline_v1',
  source_ref: 'repository://baselines/no-prediction',
  license_ref: 'internal-research',
}

const riskContent = {
  contract_version: 'ashare_daily_risk_v1',
  market: 'CN_A',
  frequency: 'daily',
  max_single_position_bp: 1000,
  max_industry_position_bp: 3000,
  max_gross_exposure_bp: 10000,
  max_concentration_hhi_bp: 1500,
  max_daily_turnover_bp: 30000,
  daily_loss_circuit_breaker_bp: 500,
  max_drawdown_circuit_breaker_bp: 1500,
  uncertain_state_action: 'freeze_risk_increase',
  risk_reduction_bypasses_opening_limits: true,
  input_contract: 'risk_targets_v1',
  output_contract: 'risk_decision_v1',
}

function containerWire(id, latestVersionId) {
  return {
    id,
    slug: `slug-${id}`,
    name: `name-${id}`,
    description: null,
    owner_key: 'frontend-dev-researcher',
    version_count: 3,
    latest_version_id: latestVersionId,
    latest_version_no: 3,
    latest_version_status: 'frozen',
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T01:00:00Z',
  }
}

function versionWire(containerField, containerId, id, content) {
  return {
    id,
    [containerField]: containerId,
    version_no: 3,
    parent_version_id: '83a37e98-61fc-4b55-8337-c98f96aa77cf',
    status: 'frozen',
    contract_name: content.contract_version,
    content,
    content_sha256: 'a'.repeat(64),
    eligible_for_new_experiment: true,
    note: null,
    created_by_key: 'frontend-dev-researcher',
    created_at: '2026-08-13T00:00:00Z',
    frozen_by_key: 'frontend-dev-researcher',
    frozen_at: '2026-08-13T01:00:00Z',
    freeze_reason: 'reviewed',
    deprecated_by_key: null,
    deprecated_at: null,
    deprecate_reason: null,
  }
}

test('B3 mappers preserve backend UUIDs, ownership, hashes, parents and strict content', () => {
  const strategy = mapStrategy(containerWire(strategyId, strategyVersionId))
  assert.equal(strategy.latestVersionId, strategyVersionId)
  assert.equal(strategy.ownerKey, 'frontend-dev-researcher')
  assert.equal(strategy.description, null)

  const strategyVersion = mapStrategyVersion(
    versionWire('strategy_id', strategyId, strategyVersionId, strategyContent),
  )
  assert.equal(strategyVersion.strategyId, strategyId)
  assert.equal(strategyVersion.parentVersionId, '83a37e98-61fc-4b55-8337-c98f96aa77cf')
  assert.equal(strategyVersion.contentSha256, 'a'.repeat(64))
  assert.equal(strategyVersion.contractName, 'cross_sectional_momentum_v1')
  assert.equal(strategyVersion.eligibleForNewExperiment, true)
  assert.deepEqual(strategyVersion.content, strategyContent)

  const model = mapModel(containerWire(modelId, modelVersionId))
  assert.equal(model.latestVersionId, modelVersionId)
  assert.deepEqual(
    mapModelVersion(versionWire('model_id', modelId, modelVersionId, modelContent)).content,
    modelContent,
  )

  const risk = mapRiskRuleSet(containerWire(riskId, riskVersionId))
  assert.equal(risk.latestVersionId, riskVersionId)
  assert.deepEqual(
    mapRiskRuleVersion(
      versionWire('risk_rule_set_id', riskId, riskVersionId, riskContent),
    ).content,
    riskContent,
  )
})

test('B3 ownership permission requires both scope and owner, except for admin', () => {
  assert.ok(B3_ROLE_SCOPES.researcher.includes('strategy:version:create'))
  assert.ok(B3_ROLE_SCOPES.researcher.includes('model:version:deprecate'))
  assert.ok(!B3_ROLE_SCOPES.researcher.includes('risk:version:create'))
  assert.ok(B3_ROLE_SCOPES.auditor.includes('risk:version:freeze'))
  assert.ok(!B3_ROLE_SCOPES.auditor.includes('strategy:version:create'))
  assert.ok(B3_ROLE_SCOPES.admin.includes('strategy:create'))
  assert.ok(B3_ROLE_SCOPES.admin.includes('model:create'))
  assert.ok(B3_ROLE_SCOPES.admin.includes('risk:create'))
  assert.equal(
    canManageOwnedResource({
      role: 'researcher',
      scopes: B3_ROLE_SCOPES.researcher,
      requiredScope: 'strategy:version:freeze',
      actorOwnerKey: 'frontend-dev-researcher',
      resourceOwnerKey: 'frontend-dev-researcher',
    }),
    true,
  )
  assert.equal(
    canManageOwnedResource({
      role: 'researcher',
      scopes: B3_ROLE_SCOPES.researcher,
      requiredScope: 'strategy:version:freeze',
      actorOwnerKey: 'frontend-dev-researcher',
      resourceOwnerKey: 'someone-else',
    }),
    false,
  )
  assert.equal(
    canManageOwnedResource({
      role: 'auditor',
      scopes: B3_ROLE_SCOPES.auditor,
      requiredScope: 'strategy:version:freeze',
      actorOwnerKey: 'frontend-dev-auditor',
      resourceOwnerKey: 'frontend-dev-auditor',
    }),
    false,
  )
  assert.equal(
    canManageOwnedResource({
      role: 'admin',
      scopes: B3_ROLE_SCOPES.admin,
      requiredScope: 'risk:version:deprecate',
      actorOwnerKey: 'frontend-dev-admin',
      resourceOwnerKey: 'someone-else',
    }),
    true,
  )
})

test('B3 page permission state recognizes scope and object-level forbidden codes', () => {
  for (const code of ['FORBIDDEN', 'OBJECT_FORBIDDEN']) {
    assert.equal(isForbiddenError(new ApiError({ code, message: code, requestId: 'request-id' })), true)
  }
  assert.equal(isForbiddenError(new ApiError({ code: 'NOT_FOUND', message: 'missing', requestId: 'request-id' })), false)
})

test('B3 version detail pages reject cross-container route bindings before lifecycle actions', async () => {
  const server = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  const cases = [
    {
      page: 'StrategyVersionDetail.tsx',
      helper: 'isStrategyVersionRouteBindingValid',
      routeId: strategyId,
      invocation: 'isStrategyVersionRouteBindingValid(strategyId, data.strategyId)',
    },
    {
      page: 'ModelVersionDetail.tsx',
      helper: 'isModelVersionRouteBindingValid',
      routeId: modelId,
      invocation: 'isModelVersionRouteBindingValid(modelId, data.modelId)',
    },
    {
      page: 'RiskRuleVersionDetail.tsx',
      helper: 'isRiskRuleVersionRouteBindingValid',
      routeId: riskId,
      invocation: 'isRiskRuleVersionRouteBindingValid(riskRuleSetId, data.riskRuleSetId)',
    },
  ]

  try {
    for (const { page, helper, routeId, invocation } of cases) {
      const source = readFileSync(resolve(frontendRoot, 'src/pages', page), 'utf8')
      const guardIndex = source.indexOf(`if (!${invocation})`)
      assert.ok(guardIndex >= 0, `${page} must fail closed on a container/version mismatch`)
      assert.ok(guardIndex < source.indexOf('const canFreeze'), `${page} checks binding before permissions`)
      assert.ok(guardIndex < source.indexOf('<ConfirmModal'), `${page} checks binding before lifecycle UI`)
      assert.match(source.slice(guardIndex, source.indexOf('const canFreeze')), /return <PageError/)

      const module = await server.ssrLoadModule(`/src/pages/${page}`)
      assert.equal(module[helper](routeId, routeId), true)
      assert.equal(module[helper](routeId, `${routeId}-other-container`), false)
      assert.equal(module[helper]('', routeId), false)
    }
  } finally {
    await server.close()
  }
})

test('every B3 real mutation uses the exact endpoint and sends Idempotency-Key', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const responses = [
    containerWire(strategyId, strategyVersionId),
    versionWire('strategy_id', strategyId, strategyVersionId, strategyContent),
    versionWire('strategy_id', strategyId, strategyVersionId, strategyContent),
    versionWire('strategy_id', strategyId, strategyVersionId, strategyContent),
    containerWire(modelId, modelVersionId),
    versionWire('model_id', modelId, modelVersionId, modelContent),
    versionWire('model_id', modelId, modelVersionId, modelContent),
    versionWire('model_id', modelId, modelVersionId, modelContent),
    containerWire(riskId, riskVersionId),
    versionWire('risk_rule_set_id', riskId, riskVersionId, riskContent),
    versionWire('risk_rule_set_id', riskId, riskVersionId, riskContent),
    versionWire('risk_rule_set_id', riskId, riskVersionId, riskContent),
  ]
  globalThis.fetch = async (input, init) => {
    const item = responses[calls.length]
    calls.push({
      path: new URL(String(input)).pathname,
      method: init?.method,
      idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
    })
    return Response.json({ item, audit_event_id: `audit-${calls.length}` })
  }

  try {
    const options = { idempotencyKey: 'idem-b3-test' }
    await createStrategy({ slug: 'strategy', name: 'Strategy', description: null }, options)
    await createStrategyVersion(strategyId, { content: strategyContent, parentVersionId: strategyVersionId, note: null }, options)
    await freezeStrategyVersion(strategyVersionId, 'freeze', options)
    await deprecateStrategyVersion(strategyVersionId, 'deprecate', options)
    await createModel({ slug: 'model', name: 'Model', description: null }, options)
    await createModelVersion(modelId, { content: modelContent, parentVersionId: modelVersionId, note: null }, options)
    await freezeModelVersion(modelVersionId, 'freeze', options)
    await deprecateModelVersion(modelVersionId, 'deprecate', options)
    await createRiskRuleSet({ slug: 'risk', name: 'Risk', description: null }, options)
    await createRiskRuleVersion(riskId, { content: riskContent, parentVersionId: riskVersionId, note: null }, options)
    await freezeRiskRuleVersion(riskVersionId, 'freeze', options)
    await deprecateRiskRuleVersion(riskVersionId, 'deprecate', options)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/v1/strategies',
    `/api/v1/strategies/${strategyId}/versions`,
    `/api/v1/strategy-versions/${strategyVersionId}/freeze`,
    `/api/v1/strategy-versions/${strategyVersionId}/deprecate`,
    '/api/v1/models',
    `/api/v1/models/${modelId}/versions`,
    `/api/v1/model-versions/${modelVersionId}/freeze`,
    `/api/v1/model-versions/${modelVersionId}/deprecate`,
    '/api/v1/risk-rule-sets',
    `/api/v1/risk-rule-sets/${riskId}/versions`,
    `/api/v1/risk-rule-versions/${riskVersionId}/freeze`,
    `/api/v1/risk-rule-versions/${riskVersionId}/deprecate`,
  ])
  assert.ok(calls.every(({ method }) => method === 'POST'))
  assert.ok(calls.every(({ idempotencyKey }) => idempotencyKey === 'idem-b3-test'))
})

test('empty database bootstrap can create an initial strict draft with a null parent', async () => {
  const originalFetch = globalThis.fetch
  const bodies = []
  const responses = [
    versionWire('strategy_id', strategyId, strategyVersionId, strategyContent),
    versionWire('model_id', modelId, modelVersionId, modelContent),
    versionWire('risk_rule_set_id', riskId, riskVersionId, riskContent),
  ]
  globalThis.fetch = async (_input, init) => {
    const item = responses[bodies.length]
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ item, audit_event_id: `audit-initial-${bodies.length}` })
  }
  try {
    const options = { idempotencyKey: 'initial-version-test' }
    await createStrategyVersion(strategyId, { content: strategyContent, parentVersionId: null, note: 'initial' }, options)
    await createModelVersion(modelId, { content: modelContent, parentVersionId: null, note: 'initial' }, options)
    await createRiskRuleVersion(riskId, { content: riskContent, parentVersionId: null, note: 'initial' }, options)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(bodies.length, 3)
  assert.ok(bodies.every(({ parent_version_id }) => parent_version_id === null))
  assert.deepEqual(bodies.map(({ content }) => content.contract_version), [
    'cross_sectional_momentum_v1',
    'no_prediction_baseline_v1',
    'ashare_daily_risk_v1',
  ])
})

test('all B3 real facades surface network errors and never fall back to mock data', async () => {
  const previousMode = process.env.VITE_API_MODE
  const originalFetch = globalThis.fetch
  process.env.VITE_API_MODE = 'real'
  globalThis.fetch = async () => {
    throw new Error('backend unavailable')
  }
  const server = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  try {
    for (const modulePath of [
      '/src/api/strategies/index.ts',
      '/src/api/models/index.ts',
      '/src/api/risk/index.ts',
    ]) {
      const api = await server.ssrLoadModule(modulePath)
      assert.equal(api.readsAreReal, true)
      await assert.rejects(
        () => modulePath.includes('strategies')
          ? api.listStrategies()
          : modulePath.includes('models')
            ? api.listModels()
            : api.listRiskRuleSets(),
        (error) => error?.code === 'NETWORK_ERROR',
      )
    }
  } finally {
    await server.close()
    globalThis.fetch = originalFetch
    if (previousMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = previousMode
  }
})

test('B3 pages use facades, preserve real UUID routes and isolate unavailable B4/B5 views', () => {
  const pages = [
    'StrategyList.tsx',
    'StrategyDetail.tsx',
    'StrategyVersionDetail.tsx',
    'ModelDetail.tsx',
    'ModelVersionDetail.tsx',
    'RiskOverview.tsx',
    'RiskRuleSetDetail.tsx',
    'RiskRuleVersionDetail.tsx',
    'ExperimentNew.tsx',
    'RunDetail.tsx',
  ]
  for (const page of pages) {
    const source = readFileSync(resolve(frontendRoot, 'src/pages', page), 'utf8')
    assert.doesNotMatch(source, /api\/mock\//, `${page} imports a mock directly`)
  }

  const strategyList = readFileSync(resolve(frontendRoot, 'src/pages/StrategyList.tsx'), 'utf8')
  assert.doesNotMatch(strategyList, /-v\$\{/)
  assert.match(strategyList, /latestVersionId/)

  const router = readFileSync(resolve(frontendRoot, 'src/router/index.tsx'), 'utf8')
  assert.match(router, /path: 'models\/:modelId'/)
  assert.match(router, /path: 'risk\/rule-sets\/:riskRuleSetId'/)
  assert.match(router, /path: 'risk\/rule-sets\/:riskRuleSetId\/versions\/:versionId'/)

  const riskOverview = readFileSync(resolve(frontendRoot, 'src/pages/RiskOverview.tsx'), 'utf8')
  // B6+ 已解除 B5 隔离：RiskOverview 通过 listRiskEvents facade 接入风险事件（real 调 B5 /risk-events，mock 返回空集）
  // 保留 DisabledNotice 用于权限不足场景（canReadEvents=false）
  assert.match(riskOverview, /DisabledNotice/)
  assert.match(riskOverview, /listRiskEvents/)

  // ExperimentNew 仍隔离 real 模式（B3 不提交 real 实验）
  const experimentNew = readFileSync(resolve(frontendRoot, 'src/pages/ExperimentNew.tsx'), 'utf8')
  assert.match(experimentNew, /isRealApiMode/)
  assert.match(experimentNew, /DisabledNotice/)
  assert.match(experimentNew, /lazy\(\(\) => import\(/)

  // RunDetail 在 B6+ 已启用 real 模式（B4 /runs/{id} 端点已就绪），不再隔离
  const runDetail = readFileSync(resolve(frontendRoot, 'src/pages/RunDetail.tsx'), 'utf8')
  assert.match(runDetail, /isRealApiMode/)
  assert.match(runDetail, /lazy\(\(\) => import\(/)

  const strategyListSource = readFileSync(resolve(frontendRoot, 'src/pages/StrategyList.tsx'), 'utf8')
  assert.match(strategyListSource, /strategy:create/)
  assert.match(strategyListSource, /model:create/)
  assert.match(strategyListSource, /ResearchContainerCreateModal/)
  const riskListSource = readFileSync(resolve(frontendRoot, 'src/pages/RiskOverview.tsx'), 'utf8')
  assert.match(riskListSource, /risk:create/)
  assert.match(riskListSource, /ResearchContainerCreateModal/)
  for (const page of ['StrategyDetail.tsx', 'ModelDetail.tsx', 'RiskRuleSetDetail.tsx']) {
    const source = readFileSync(resolve(frontendRoot, 'src/pages', page), 'utf8')
    assert.match(source, /createInitial/)
    assert.match(source, /创建首个版本/)
  }
})
