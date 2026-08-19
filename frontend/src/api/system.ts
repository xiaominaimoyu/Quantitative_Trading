/**
 * 系统健康 facade：real 模式调用 B6 `/health/system`，mock 模式回退到本地样本。
 *
 * 后端 `/health/system` 返回的 schema 与 mock `SystemHealthData` 不同：
 * - 后端不返回 services 列表 → 由 database/migration/storage writable 派生
 * - 后端 workers 只暴露 alive + last_seen_at → 派生 status（alive→idle，否则 offline）
 * - 后端不暴露 currentTask / lastBackup / lastRestoreDrill → 用占位值
 * 统一返回 SystemHealthData（页面消费的稳定形状），屏蔽差异。
 */
import { API_MODE } from './config.ts'
import { apiRequest } from './http.ts'
import * as mock from './mock/system.ts'

export type ServiceStatus = mock.ServiceStatus
export type WorkerInfo = mock.WorkerInfo
export type SystemHealthData = mock.SystemHealthData

const useReal = API_MODE === 'real'

interface RealSystemHealth {
  status: string
  database: string
  migration: { current: string | null; head: string }
  workers: Array<{ worker_id: string; last_seen_at: string | null; alive: boolean }>
  tasks: { queued: number; claimed: number; running: number }
  storage: {
    artifact_root: { path: string; writable: boolean; size_bytes: number }
    data_root: { path: string; writable: boolean; size_bytes: number }
  }
  timestamp: string
}

const BYTES_PER_GB = 1024 ** 3

function bytesToGb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_GB) * 10) / 10
}

function mapRealToSystemHealth(raw: RealSystemHealth): SystemHealthData {
  const services: ServiceStatus[] = []
  services.push({
    name: 'PostgreSQL',
    status: raw.database === 'ok' ? 'ok' : 'down',
    lastOk: raw.timestamp,
    detail: raw.database === 'ok' ? undefined : '数据库不可连接',
  })
  const migrationOk =
    raw.migration.current !== null && raw.migration.current === raw.migration.head
  services.push({
    name: '数据库迁移',
    status: migrationOk ? 'ok' : 'degraded',
    lastOk: raw.timestamp,
    detail: migrationOk
      ? `当前 ${raw.migration.current}`
      : `当前 ${raw.migration.current ?? '缺失'} ≠ head ${raw.migration.head}`,
  })
  services.push({
    name: '产物目录',
    status: raw.storage.artifact_root.writable ? 'ok' : 'down',
    lastOk: raw.timestamp,
    detail: raw.storage.artifact_root.writable
      ? raw.storage.artifact_root.path
      : `不可写：${raw.storage.artifact_root.path}`,
  })
  services.push({
    name: '数据目录',
    status: raw.storage.data_root.writable ? 'ok' : 'down',
    lastOk: raw.timestamp,
    detail: raw.storage.data_root.writable
      ? raw.storage.data_root.path
      : `不可写：${raw.storage.data_root.path}`,
  })

  const workers: WorkerInfo[] = raw.workers.map((w) => ({
    id: w.worker_id,
    status: w.alive ? 'idle' : 'offline',
    lastHeartbeat: w.last_seen_at ?? raw.timestamp,
  }))

  return {
    services,
    workers,
    queueDepth: raw.tasks.queued,
    storage: {
      dataGb: bytesToGb(raw.storage.data_root.size_bytes),
      artifactsGb: bytesToGb(raw.storage.artifact_root.size_bytes),
      // 后端 /health/system 不暴露 DB 体积，置零避免误导
      dbGb: 0,
    },
    // 后端 /health/system 不暴露备份/演练时间，留空由页面显示「无数据」
    lastBackup: '',
    lastRestoreDrill: '',
  }
}

export async function getSystemHealth(): Promise<SystemHealthData> {
  if (useReal) {
    const raw = await apiRequest<RealSystemHealth>('/health/system')
    return mapRealToSystemHealth(raw)
  }
  return mock.getSystemHealth()
}
