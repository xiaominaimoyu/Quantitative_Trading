import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let server
let submitExperiment
let getExperiment
let getRunDetail
let listTasks
let resolveTaskTarget

test.before(async () => {
  server = await createServer({
    root: frontendRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  ;({ submitExperiment } = await server.ssrLoadModule('/src/api/mock/experimentNew.ts'))
  ;({ getExperiment } = await server.ssrLoadModule('/src/api/mock/experiments.ts'))
  ;({ getRunDetail } = await server.ssrLoadModule('/src/api/mock/runs.ts'))
  ;({ listTasks } = await server.ssrLoadModule('/src/api/mock/tasks.ts'))
  ;({ resolveTaskTarget } = await server.ssrLoadModule('/src/components/task-center/taskTarget.ts'))
})

test.after(async () => {
  await server?.close()
})

function draft(overrides = {}) {
  return {
    hypothesis: {
      statement: '验证动量因子的样本外表现',
      primaryMetrics: ['Sharpe'],
      secondaryMetrics: ['换手率'],
      failureConditions: '样本外 Sharpe 小于 0.5',
      stopRule: '连续三个窗口失败时停止',
    },
    datasetVersionId: 'ds-ashare-v3',
    universe: '沪深300',
    pointInTimeRule: 'T+1 可交易，后复权',
    strategyVersionId: 'st-momentum-v2',
    baselineIds: ['m-buyhold-v1'],
    candidateIds: ['m-lgbm-v1'],
    split: {
      trainStart: '2015-01-01',
      trainEnd: '2020-12-31',
      validationStart: '2021-01-01',
      validationEnd: '2023-12-31',
      testStart: '2024-01-01',
      testEnd: '2025-12-31',
      walkForwardWindows: 6,
      purgeDays: 5,
      embargoDays: 5,
    },
    cost: { commissionBp: 3, slippageBp: 5, turnoverLimitPct: 300 },
    riskRuleSetId: 'rc-standard-v1',
    budget: { searchSpace: 'topN x holdDays', maxAttempts: 12, seeds: [42, 43, 44] },
    ...overrides,
  }
}

async function assertReachableExperimentRun(experimentId, runId) {
  const [experiment, run] = await Promise.all([
    getExperiment(experimentId, { latencyMs: 0 }),
    getRunDetail(runId, { latencyMs: 0 }),
  ])
  assert.equal(experiment.id, experimentId)
  assert.equal(run.id, runId)
  assert.equal(run.experimentId, experimentId)
}

test('new experiment submission registers a queryable experiment and run', async () => {
  const submittedDraft = draft({
    budget: { searchSpace: 'topN x holdDays', maxAttempts: 12, seeds: [91] },
  })
  const result = await submitExperiment(
    submittedDraft,
    { latencyMs: 0 },
  )

  assert.equal(result.isDuplicate, false)
  await assertReachableExperimentRun(result.experimentId, result.runId)
  const registered = await getExperiment(result.experimentId, { latencyMs: 0 })
  assert.deepEqual(registered.protocol, submittedDraft)
})

test('duplicate and forced-run branches only return reachable targets', async () => {
  const duplicateDraft = draft()
  const duplicate = await submitExperiment(duplicateDraft, { latencyMs: 0 })

  assert.equal(duplicate.isDuplicate, true)
  await assertReachableExperimentRun(
    duplicate.existingExperimentId,
    duplicate.existingRunId,
  )
  const existingRun = await getRunDetail(duplicate.existingRunId, { latencyMs: 0 })
  assert.equal(existingRun.status, 'success')

  const forced = await submitExperiment(duplicateDraft, { latencyMs: 0, force: true })
  assert.equal(forced.isDuplicate, false)
  await assertReachableExperimentRun(forced.experimentId, forced.runId)
})

test('task targets are explicit and every navigable target is queryable', async () => {
  const tasks = await listTasks({ latencyMs: 0 })
  const targets = new Map(tasks.map((task) => [task.id, resolveTaskTarget(task)]))

  assert.equal(targets.get('task-0001'), '/experiments/exp-momentum-0042/runs/R-0042')
  assert.equal(targets.get('task-0006'), '/experiments/exp-lgbm-0008/runs/R-0035')
  assert.equal(targets.get('task-0002'), null)
  assert.equal(targets.get('task-0003'), null)

  for (const path of targets.values()) {
    if (!path) continue
    const match = /^\/experiments\/([^/]+)\/runs\/([^/]+)$/.exec(path)
    assert.ok(match, `unexpected task target: ${path}`)
    await assertReachableExperimentRun(match[1], match[2])
  }
})

test('TaskCenter consumes the tested resolver instead of a fixed experiment id', () => {
  const source = readFileSync(
    resolve(frontendRoot, 'src/components/task-center/TaskCenter.tsx'),
    'utf8',
  )
  assert.match(source, /resolveTaskTarget\(task\)/)
  assert.doesNotMatch(source, /MOCK_EXPERIMENT_ID/)
})
