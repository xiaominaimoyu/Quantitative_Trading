/**
 * 工作台 Mock：待处理事项、最近运行、系统摘要。
 */

import { mockRequest, type MockRequestOptions } from '@/api/client'
import { listTasks } from '@/api/mock/tasks'

export { listTasks }

export interface TodoItem {
  id: string
  severity: 'warning' | 'info' | 'success'
  text: string
  actionLabel: string
  actionPath: string
}

export interface RecentRun {
  id: string
  experimentId: string
  status: string
  label: string
  timeAgo: string
}

export interface SystemSummary {
  workerStatus: 'ok' | 'degraded' | 'down'
  storagePct: number
  lastBackup: string
}

const MOCK_TODOS: TodoItem[] = [
  {
    id: 'todo-1',
    severity: 'warning',
    text: '数据集「基本面因子面板」新版本校验阻断 — 缺失 2 个交易日',
    actionLabel: '去处理',
    actionPath: '/datasets/ds-fundamental',
  },
  {
    id: 'todo-2',
    severity: 'info',
    text: '运行 R-0041 已完成，待查看',
    actionLabel: '查看',
    actionPath: '/experiments/exp-momentum-0042/runs/R-0041',
  },
  {
    id: 'todo-3',
    severity: 'warning',
    text: '报告 RP-0098 待批准',
    actionLabel: '去审批',
    actionPath: '/reports/RP-0098',
  },
]

const MOCK_RECENT_RUNS: RecentRun[] = [
  {
    id: 'R-0041',
    experimentId: 'exp-momentum-0042',
    status: 'success',
    label: '动量策略 v2 · 线性回归',
    timeAgo: '2 小时前',
  },
  {
    id: 'R-0035',
    experimentId: 'exp-lgbm-0008',
    status: 'failed',
    label: 'LightGBM v1',
    timeAgo: '昨天',
  },
  {
    id: 'R-0038',
    experimentId: 'exp-momentum-0042',
    status: 'success',
    label: '动量因子 · 样本外验证',
    timeAgo: '昨天',
  },
]

export function listTodos(options?: MockRequestOptions): Promise<TodoItem[]> {
  return mockRequest(() => MOCK_TODOS.map((t) => ({ ...t })), options)
}

export function listRecentRuns(options?: MockRequestOptions): Promise<RecentRun[]> {
  return mockRequest(() => MOCK_RECENT_RUNS.map((r) => ({ ...r })), options)
}

export function getSystemSummary(options?: MockRequestOptions): Promise<SystemSummary> {
  return mockRequest(
    () => ({
      workerStatus: 'ok' as const,
      storagePct: 62,
      lastBackup: '今天 03:00',
    }),
    options,
  )
}

export function listDashboardTasks(options?: MockRequestOptions) {
  return listTasks(options)
}
