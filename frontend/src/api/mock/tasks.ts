/**
 * 任务中心 Mock 数据与查询函数。
 *
 * 状态域覆盖：排队中 / 已领取 / 运行中 / 请求取消 / 成功 / 失败 / 已取消。
 * 注意：运行中任务的 durationSec 为「当前已运行时长」，终态任务为实际耗时。
 */

import { ApiError, mockRequest, type MockRequestOptions } from '@/api/client'

/** 任务状态（与 StatusTag run/task 域词表一致） */
export type TaskStatus =
  | 'queued' // 排队中
  | 'claimed' // 已领取
  | 'running' // 运行中
  | 'cancel_requested' // 请求取消
  | 'success' // 成功
  | 'failed' // 失败
  | 'canceled' // 已取消

/** 任务类型 */
export type TaskType =
  | 'backtest' // 回测
  | 'validation' // 验证
  | 'data_ingest' // 数据导入
  | 'report' // 报告生成
  | 'simulation' // 模拟运行

export interface ExperimentRunTaskTarget {
  kind: 'experiment-run'
  experimentId: string
  runId: string
}

export type TaskTarget = ExperimentRunTaskTarget

export interface Task {
  id: string
  runId: string
  name: string
  type: TaskType
  status: TaskStatus
  /** 0–100 */
  progress: number
  workerId: string
  /** ISO 时间字符串（Asia/Shanghai 语境） */
  startedAt: string
  /** 已运行时长（秒） */
  durationSec: number
  /** 仅在详情对象可定位时提供；缺省表示该任务不可导航。 */
  target?: TaskTarget
}

/** 任务类型 → 中文标签 */
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  backtest: '回测',
  validation: '验证',
  data_ingest: '数据导入',
  report: '报告生成',
  simulation: '模拟运行',
}

/** 终态（停止轮询） */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'canceled'
}

/** 活动（需轮询） */
export function isActiveTaskStatus(status: TaskStatus): boolean {
  return status === 'running' || status === 'cancel_requested'
}

/** 排队（慢轮询） */
export function isQueuedTaskStatus(status: TaskStatus): boolean {
  return status === 'queued' || status === 'claimed'
}

const MOCK_TASKS: Task[] = [
  {
    id: 'task-0001',
    runId: 'R-0042',
    name: '动量因子·沪深300·周频回测',
    type: 'backtest',
    status: 'running',
    progress: 64,
    workerId: 'worker-gpu-03',
    startedAt: '2026-08-08T10:24:00+08:00',
    durationSec: 942,
    target: {
      kind: 'experiment-run',
      experimentId: 'exp-momentum-0042',
      runId: 'R-0042',
    },
  },
  {
    id: 'task-0002',
    runId: 'R-0043',
    name: '波动率因子·样本外验证',
    type: 'validation',
    status: 'running',
    progress: 27,
    workerId: 'worker-gpu-01',
    startedAt: '2026-08-08T10:58:00+08:00',
    durationSec: 311,
  },
  {
    id: 'task-0003',
    runId: 'R-0044',
    name: '日频量价数据·增量导入',
    type: 'data_ingest',
    status: 'queued',
    progress: 0,
    workerId: 'worker-io-02',
    startedAt: '2026-08-08T11:02:00+08:00',
    durationSec: 0,
  },
  {
    id: 'task-0004',
    runId: 'R-0045',
    name: '因子组合优化·风险约束',
    type: 'backtest',
    status: 'claimed',
    progress: 3,
    workerId: 'worker-gpu-02',
    startedAt: '2026-08-08T11:05:00+08:00',
    durationSec: 4,
  },
  {
    id: 'task-0005',
    runId: 'R-0038',
    name: '动量因子·样本外验证',
    type: 'validation',
    status: 'success',
    progress: 100,
    workerId: 'worker-gpu-01',
    startedAt: '2026-08-08T08:12:00+08:00',
    durationSec: 1840,
  },
  {
    id: 'task-0006',
    runId: 'R-0035',
    name: '波动率因子·A股全样本回测',
    type: 'backtest',
    status: 'failed',
    progress: 41,
    workerId: 'worker-gpu-02',
    startedAt: '2026-08-07T16:40:00+08:00',
    durationSec: 1215,
    target: {
      kind: 'experiment-run',
      experimentId: 'exp-lgbm-0008',
      runId: 'R-0035',
    },
  },
  {
    id: 'task-0007',
    runId: 'R-0033',
    name: '流动性因子·日频回测',
    type: 'backtest',
    status: 'canceled',
    progress: 22,
    workerId: 'worker-gpu-03',
    startedAt: '2026-08-07T14:03:00+08:00',
    durationSec: 683,
  },
  {
    id: 'task-0008',
    runId: 'R-0039',
    name: '七月运行月报·生成',
    type: 'report',
    status: 'success',
    progress: 100,
    workerId: 'worker-cpu-01',
    startedAt: '2026-08-08T09:30:00+08:00',
    durationSec: 128,
  },
]

/** 查询全部任务 */
export function listTasks(options?: MockRequestOptions): Promise<Task[]> {
  return mockRequest(
    () => MOCK_TASKS.map((t) => ({ ...t })),
    options,
  )
}

/** 查询单个任务 */
export function getTask(
  id: string,
  options?: MockRequestOptions,
): Promise<Task> {
  return mockRequest(
    () => {
      const task = MOCK_TASKS.find((t) => t.id === id)
      if (!task) {
        throw new ApiError({
          code: 'IR-0404',
          message: `任务不存在：${id}`,
          requestId: 'REQ-00000000-0000',
        })
      }
      return { ...task }
    },
    options,
  )
}
