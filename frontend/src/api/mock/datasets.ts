import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'
import type {
  CreateDatasetSnapshotInput,
  CreateDatasetSnapshotOptions,
  CreateDatasetSnapshotResult,
  DataSource,
  DataSourceListQuery,
  Dataset,
  DatasetListQuery,
  DatasetManifest,
  DatasetVersion,
  DatasetVersionListQuery,
  PagedResult,
  QualityRun,
  SnapshotTask,
  VersionLineage,
} from '@/api/datasets/types'

export type {
  CreateDatasetSnapshotInput,
  Dataset,
  DatasetVersion,
  DatasetVersionStatus,
  QualityStatus,
} from '@/api/datasets/types'

const MOCK_DATA_SOURCES: DataSource[] = [
  {
    id: 'src-fixture',
    name: 'Deterministic fixture',
    adapter: 'deterministic_fixture',
    license: '仅开发与测试',
    status: 'active',
  },
  {
    id: 'src-index',
    name: '中证指数',
    adapter: 'fixture_index',
    license: '公开 + 内部衍生',
    status: 'active',
  },
]

const MOCK_DATASETS: Dataset[] = [
  {
    id: 'ds-ashare',
    slug: 'a-share-daily',
    name: 'A 股日频行情',
    market: 'A 股',
    frequency: '日频',
    sourceId: 'src-fixture',
    source: 'Deterministic fixture',
    license: '仅开发与测试',
    schemaVersion: 'market_bar_v1',
    latestVersionId: 'ds-ashare-v3',
    latestVersion: 3,
    latestVersionStatus: 'available',
    timeRange: '2015-01-01 ~ 2025-12-31',
    rowCount: 1843200,
    qualityStatus: 'passed',
    logicalContentSha256: 'sha256:mock-logical-v3',
    eligibleForFormalUse: true,
    gateDecision: 'eligible',
    gateReasons: [],
    updatedAt: '2026-07-20T09:00:00+08:00',
  },
  {
    id: 'ds-index',
    slug: 'index-constituents',
    name: '指数成分与权重',
    market: 'A 股',
    frequency: '日频',
    sourceId: 'src-index',
    source: '中证指数',
    license: '公开 + 内部衍生',
    schemaVersion: 'index_constituent_v1',
    latestVersionId: 'ds-index-v1',
    latestVersion: 1,
    latestVersionStatus: 'available',
    timeRange: '2015-01-01 ~ 2025-12-31',
    rowCount: 256000,
    qualityStatus: 'passed',
    logicalContentSha256: 'sha256:mock-index-v1',
    eligibleForFormalUse: true,
    gateDecision: 'eligible',
    gateReasons: [],
    updatedAt: '2026-06-10T11:30:00+08:00',
  },
]

function manifestFor(version: DatasetVersion): DatasetManifest {
  return {
    manifestVersion: '1',
    schemaVersion: 'market_bar_v1',
    datasetId: version.datasetId,
    datasetVersionId: version.id,
    parentVersionId: version.parentVersionId,
    source: {
      name: version.source ?? 'Deterministic fixture',
      revision: 'fixture-v1',
      license: '仅开发与测试',
    },
    market: 'CN',
    frequency: 'daily',
    timezone: version.timezone ?? 'Asia/Shanghai',
    adjustment: version.adjustment ?? 'backward',
    schemaFingerprint: 'sha256:mock-schema',
    primaryKey: ['symbol', 'exchange', 'event_time'],
    sortKey: ['event_time', 'symbol', 'exchange'],
    rowCount: version.rowCount,
    timeRange: { start: version.timeStart, end: version.timeEnd },
    partitions: [{
      relativePath: 'market=CN/interval=1d/year=2025/part-000.parquet',
      rowCount: version.rowCount,
      sizeBytes: 4096,
      timeRange: { start: version.timeStart, end: version.timeEnd },
      symbolRange: { start: '000001.SZ', end: '600000.SH' },
      fileSha256: `sha256:mock-file-${version.version}`,
    }],
    writerProfile: {
      parquetVersion: '2.6',
      compression: 'zstd',
      compressionLevel: 3,
      useDictionary: ['symbol', 'exchange'],
      writeStatistics: true,
      rowGroupSize: 65536,
      dataPageVersion: '2.0',
      timestampUnit: 'us',
    },
    generation: {
      taskId: version.taskId ?? `task-${version.id}`,
      codeVersion: 'mock-commit',
      configHash: `sha256:mock-config-${version.version}`,
    },
    quality: {
      ruleSet: 'market_bar_v1.0',
      status: version.qualityStatus,
      runId: `quality-${version.id}`,
      reportArtifactId: `artifact-quality-${version.id}`,
      reportRelativePath: 'quality/report.json',
      reportSha256: `sha256:mock-quality-report-${version.version}`,
    },
    logicalContentSha256: version.logicalContentSha256 ?? `sha256:mock-logical-${version.version}`,
    manifestSha256: version.manifestSha256 ?? `sha256:mock-manifest-${version.version}`,
  }
}

function version(values: Partial<DatasetVersion> & Pick<DatasetVersion, 'id' | 'datasetId' | 'version'>): DatasetVersion {
  const item: DatasetVersion = {
    id: values.id,
    datasetId: values.datasetId,
    version: values.version,
    parentVersionId: values.parentVersionId ?? null,
    dataSourceId: values.dataSourceId ?? 'src-fixture',
    source: values.source ?? 'Deterministic fixture',
    taskId: values.taskId ?? `task-${values.id}`,
    status: values.status ?? 'available',
    qualityStatus: values.qualityStatus ?? 'passed',
    qualitySummary: values.qualitySummary ?? '质量规则已完成。',
    timeStart: values.timeStart ?? '2015-01-01',
    timeEnd: values.timeEnd ?? '2025-12-31',
    timeRange: values.timeRange ?? '2015-01-01 ~ 2025-12-31',
    timezone: values.timezone ?? 'Asia/Shanghai',
    adjustment: values.adjustment ?? 'backward',
    rowCount: values.rowCount ?? 1843200,
    logicalContentSha256: values.logicalContentSha256 ?? `sha256:mock-logical-${values.version}`,
    manifestSha256: values.manifestSha256 ?? `sha256:mock-manifest-${values.version}`,
    eligibleForFormalUse: values.eligibleForFormalUse ?? true,
    gateDecision: values.gateDecision ?? 'eligible',
    gateReasons: values.gateReasons ?? [],
    manifest: null,
    createdAt: values.createdAt ?? '2026-07-20T09:00:00+08:00',
  }
  item.manifest = values.manifest === undefined && item.status === 'available'
    ? manifestFor(item)
    : values.manifest ?? null
  return item
}

const MOCK_DATASET_VERSIONS: DatasetVersion[] = [
  version({ id: 'ds-ashare-v3', datasetId: 'ds-ashare', version: 3, parentVersionId: 'ds-ashare-v2' }),
  version({
    id: 'ds-ashare-v2',
    datasetId: 'ds-ashare',
    version: 2,
    parentVersionId: 'ds-ashare-v1',
    qualityStatus: 'warning',
    qualitySummary: '存在有限交易日覆盖缺口，规则集允许使用。',
    gateDecision: 'eligible',
  }),
  version({
    id: 'ds-ashare-v1',
    datasetId: 'ds-ashare',
    version: 1,
    status: 'deprecated',
    qualityStatus: 'blocked',
    qualitySummary: '价格规则阻断。',
    eligibleForFormalUse: false,
    gateDecision: 'not_eligible',
    gateReasons: ['quality_blocked', 'version_deprecated'],
    manifest: null,
  }),
  version({ id: 'ds-index-v1', datasetId: 'ds-index', version: 1, dataSourceId: 'src-index', source: '中证指数' }),
]

const MOCK_TASKS = new Map<string, SnapshotTask>()
const MOCK_PROGRESS = new Map<string, number>()
const IDEMPOTENT_RESULTS = new Map<string, { fingerprint: string; result: CreateDatasetSnapshotResult }>()

function paged<T>(items: T[], page = 1, pageSize = 20): PagedResult<T> {
  const start = Math.max(0, page - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)
  const hasMore = start + pageSize < items.length
  return {
    items: pageItems,
    page: { hasMore, nextCursor: hasMore ? page + 1 : null },
  }
}

export function listDataSources(
  query: DataSourceListQuery = {},
  options?: MockRequestOptions,
): Promise<PagedResult<DataSource>> {
  return mockRequest(() => {
    const items = MOCK_DATA_SOURCES.filter((item) =>
      (!query.name || item.name.includes(query.name)) &&
      (!query.adapter || item.adapter === query.adapter) &&
      (!query.status || item.status === query.status))
    return paged(items, query.page, query.pageSize ?? 100)
  }, options)
}

export function listDatasets(
  query: DatasetListQuery = {},
  options?: MockRequestOptions,
): Promise<PagedResult<Dataset>> {
  return mockRequest(() => {
    const items = MOCK_DATASETS.filter((item) =>
      (!query.name || item.name.includes(query.name)) &&
      (!query.market || item.market === query.market) &&
      (!query.frequency || item.frequency === query.frequency || item.frequency === '日频' && query.frequency === 'daily') &&
      (!query.status || item.latestVersionStatus === query.status) &&
      (!query.sourceId || item.sourceId === query.sourceId))
    return paged(items, query.page, query.pageSize)
  }, options)
}

export function getDataset(id: string, options?: MockRequestOptions): Promise<Dataset> {
  return mockRequest(() => {
    const item = MOCK_DATASETS.find((candidate) => candidate.id === id)
    if (!item) throw notFound('数据集', id)
    return { ...item, gateReasons: [...item.gateReasons] }
  }, options)
}

export function listDatasetVersions(
  datasetId: string,
  options?: MockRequestOptions,
): Promise<DatasetVersion[]> {
  return mockRequest(
    () => MOCK_DATASET_VERSIONS
      .filter((item) => item.datasetId === datasetId)
      .sort((left, right) => right.version - left.version)
      .map(copyVersion),
    options,
  )
}

export function listDatasetVersionPage(
  datasetId: string,
  query: DatasetVersionListQuery = {},
  options?: MockRequestOptions,
): Promise<PagedResult<DatasetVersion>> {
  return mockRequest(() => {
    const items = MOCK_DATASET_VERSIONS
      .filter((item) => item.datasetId === datasetId)
      .filter((item) => !query.status || item.status === query.status)
      .filter((item) => !query.qualityStatus || item.qualityStatus === query.qualityStatus)
      .filter((item) => !query.sourceId || item.dataSourceId === query.sourceId)
      .sort((left, right) => right.version - left.version)
      .map(copyVersion)
    return paged(items, query.page, query.pageSize)
  }, options)
}

export function getDatasetVersion(id: string, options?: MockRequestOptions): Promise<DatasetVersion> {
  return mockRequest(() => {
    advanceSnapshot(id)
    const item = MOCK_DATASET_VERSIONS.find((candidate) => candidate.id === id)
    if (!item) throw notFound('数据版本', id)
    return copyVersion(item)
  }, options)
}

export function createDatasetSnapshot(
  input: CreateDatasetSnapshotInput,
  createOptions: CreateDatasetSnapshotOptions,
  requestOptions?: MockRequestOptions,
): Promise<CreateDatasetSnapshotResult> {
  return mockRequest(() => {
    const dataset = MOCK_DATASETS.find((candidate) => candidate.id === input.datasetId)
    if (!dataset) throw notFound('数据集', input.datasetId)
    if (!input.dataSourceId || !input.timeStart || !input.timeEnd || input.symbols.length === 0) {
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        message: '数据源、时间范围和标的不能为空',
        requestId: generateRequestId(),
      })
    }
    const fingerprint = JSON.stringify(input)
    const existing = IDEMPOTENT_RESULTS.get(createOptions.idempotencyKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApiError({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: '相同幂等键对应了不同请求',
          requestId: generateRequestId(),
        })
      }
      return existing.result
    }

    const siblings = MOCK_DATASET_VERSIONS.filter((item) => item.datasetId === input.datasetId)
    const versionNumber = Math.max(0, ...siblings.map((item) => item.version)) + 1
    const versionId = `${input.datasetId}-v${versionNumber}`
    const taskId = `task-${versionId}`
    const created = version({
      id: versionId,
      datasetId: input.datasetId,
      version: versionNumber,
      parentVersionId: input.parentVersionId,
      dataSourceId: input.dataSourceId,
      source: MOCK_DATA_SOURCES.find((item) => item.id === input.dataSourceId)?.name ?? null,
      taskId,
      status: 'draft',
      qualityStatus: 'pending',
      qualitySummary: null,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      timeRange: `${input.timeStart} ~ ${input.timeEnd}`,
      adjustment: input.adjustment,
      rowCount: 0,
      logicalContentSha256: null,
      manifestSha256: null,
      eligibleForFormalUse: false,
      gateDecision: 'not_eligible',
      gateReasons: ['quality_pending'],
      manifest: null,
      createdAt: new Date().toISOString(),
    })
    MOCK_DATASET_VERSIONS.unshift(created)
    MOCK_PROGRESS.set(versionId, 0)
    MOCK_TASKS.set(taskId, {
      id: taskId,
      taskType: 'data_ingest',
      status: 'queued',
      progress: 0,
      attemptCount: 0,
      errorCode: null,
      errorMessage: null,
      createdAt: created.createdAt,
      updatedAt: created.createdAt,
      completedAt: null,
    })
    dataset.latestVersionId = versionId
    dataset.latestVersion = versionNumber
    dataset.latestVersionStatus = 'draft'
    dataset.qualityStatus = 'pending'
    dataset.eligibleForFormalUse = false
    dataset.gateDecision = 'not_eligible'
    dataset.gateReasons = ['quality_pending']
    dataset.updatedAt = created.createdAt
    const result = { datasetVersionId: versionId, taskId }
    IDEMPOTENT_RESULTS.set(createOptions.idempotencyKey, { fingerprint, result })
    return result
  }, requestOptions)
}

export function getSnapshotTask(id: string, options?: MockRequestOptions): Promise<SnapshotTask> {
  return mockRequest(() => {
    const task = MOCK_TASKS.get(id)
    if (!task) throw notFound('任务', id)
    const versionId = id.replace(/^task-/, '')
    advanceSnapshot(versionId)
    return { ...MOCK_TASKS.get(id)! }
  }, options)
}

export function listQualityRuns(
  versionId: string,
  options?: MockRequestOptions,
): Promise<PagedResult<QualityRun>> {
  return mockRequest(() => {
    const versionItem = MOCK_DATASET_VERSIONS.find((item) => item.id === versionId)
    if (!versionItem) throw notFound('数据版本', versionId)
    if (versionItem.qualityStatus === 'pending') return paged([])
    return paged([qualityRunFor(versionItem)], 1, 100)
  }, options)
}

export function getVersionLineage(
  versionId: string,
  options?: MockRequestOptions,
): Promise<VersionLineage> {
  return mockRequest(() => {
    const versionItem = MOCK_DATASET_VERSIONS.find((item) => item.id === versionId)
    if (!versionItem) throw notFound('数据版本', versionId)
    const related = MOCK_DATASET_VERSIONS.filter((item) =>
      item.id === versionId || item.id === versionItem.parentVersionId)
    return {
      nodes: related.map((item) => ({
        id: item.id,
        datasetId: item.datasetId,
        version: item.version,
        status: item.status,
      })),
      edges: versionItem.parentVersionId ? [{
        parentVersionId: versionItem.parentVersionId,
        childVersionId: versionItem.id,
        relationType: 'derived_from',
      }] : [],
    }
  }, options)
}

function qualityRunFor(item: DatasetVersion): QualityRun {
  const blocked = item.qualityStatus === 'blocked' || item.qualityStatus === 'failed'
  return {
    id: `quality-${item.id}`,
    versionId: item.id,
    taskId: item.taskId,
    ruleSetVersion: 'market_bar_v1.0',
    status: item.qualityStatus,
    createdAt: item.createdAt,
    completedAt: item.status === 'validating' || item.status === 'draft' ? null : item.createdAt,
    blockedCount: blocked ? 1 : 0,
    warningCount: item.qualityStatus === 'warning' ? 1 : 0,
    reportArtifactId: `artifact-quality-${item.id}`,
    results: [{
      ruleId: blocked ? 'positive_price' : 'schema_exact',
      ruleVersion: '1',
      severity: 'blocking',
      status: blocked ? 'blocked' : 'passed',
      count: blocked ? 2 : 0,
      message: blocked ? '价格必须为正' : null,
      samples: blocked ? [{ symbol: '600000.SH' }] : [],
    }],
  }
}

function advanceSnapshot(versionId: string): void {
  const step = MOCK_PROGRESS.get(versionId)
  if (step === undefined) return
  const item = MOCK_DATASET_VERSIONS.find((candidate) => candidate.id === versionId)
  if (!item || !item.taskId) return
  const task = MOCK_TASKS.get(item.taskId)
  if (!task) return
  if (step === 0) {
    item.status = 'validating'
    task.status = 'running'
    task.progress = 50
    task.attemptCount = 1
    MOCK_PROGRESS.set(versionId, 1)
  } else {
    item.status = 'available'
    item.qualityStatus = 'passed'
    item.qualitySummary = '全部规则通过。'
    item.rowCount = 3
    item.logicalContentSha256 = `sha256:mock-logical-${item.version}`
    item.manifestSha256 = `sha256:mock-manifest-${item.version}`
    item.eligibleForFormalUse = true
    item.gateDecision = 'eligible'
    item.gateReasons = []
    item.manifest = manifestFor(item)
    task.status = 'success'
    task.progress = 100
    task.completedAt = new Date().toISOString()
    task.updatedAt = task.completedAt
    MOCK_PROGRESS.delete(versionId)
  }
}

function copyVersion(item: DatasetVersion): DatasetVersion {
  return {
    ...item,
    gateReasons: [...item.gateReasons],
    manifest: item.manifest ? {
      ...item.manifest,
      primaryKey: [...item.manifest.primaryKey],
      sortKey: [...item.manifest.sortKey],
      partitions: item.manifest.partitions.map((partition) => ({ ...partition })),
    } : null,
  }
}

function notFound(kind: string, id: string): ApiError {
  return new ApiError({
    code: 'NOT_FOUND',
    message: `${kind}不存在：${id}`,
    requestId: generateRequestId(),
  })
}
