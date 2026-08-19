/**
 * 系统健康 Mock。
 */

import { mockRequest, type MockRequestOptions } from '@/api/client'

export interface ServiceStatus {
  name: string
  status: 'ok' | 'degraded' | 'down'
  lastOk: string
  detail?: string
}

export interface WorkerInfo {
  id: string
  status: 'idle' | 'busy' | 'offline'
  currentTask?: string
  lastHeartbeat: string
}

export interface SystemHealthData {
  services: ServiceStatus[]
  workers: WorkerInfo[]
  queueDepth: number
  storage: { dataGb: number; artifactsGb: number; dbGb: number }
  lastBackup: string
  lastRestoreDrill: string
}

const MOCK_HEALTH: SystemHealthData = {
  services: [
    { name: 'API', status: 'ok', lastOk: '2026-08-08T21:40:00+08:00' },
    { name: 'Worker', status: 'ok', lastOk: '2026-08-08T21:40:00+08:00' },
    { name: 'PostgreSQL', status: 'ok', lastOk: '2026-08-08T21:35:00+08:00' },
    { name: '备份服务', status: 'ok', lastOk: '2026-08-08T03:00:00+08:00' },
  ],
  workers: [
    { id: 'worker-gpu-01', status: 'busy', currentTask: 'R-0042', lastHeartbeat: '2026-08-08T21:40:00+08:00' },
    { id: 'worker-gpu-02', status: 'busy', currentTask: 'R-0043', lastHeartbeat: '2026-08-08T21:40:00+08:00' },
    { id: 'worker-gpu-03', status: 'idle', lastHeartbeat: '2026-08-08T21:39:00+08:00' },
    { id: 'worker-io-02', status: 'idle', lastHeartbeat: '2026-08-08T21:38:00+08:00' },
  ],
  queueDepth: 2,
  storage: { dataGb: 420, artifactsGb: 180, dbGb: 45 },
  lastBackup: '2026-08-08T03:00:00+08:00',
  lastRestoreDrill: '2026-07-15T10:00:00+08:00',
}

export function getSystemHealth(options?: MockRequestOptions): Promise<SystemHealthData> {
  return mockRequest(() => ({ ...MOCK_HEALTH, services: MOCK_HEALTH.services.map((s) => ({ ...s })), workers: MOCK_HEALTH.workers.map((w) => ({ ...w })) }), options)
}
