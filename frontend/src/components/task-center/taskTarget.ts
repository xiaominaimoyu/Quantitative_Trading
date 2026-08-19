import type { Task } from '@/api/mock/tasks'

export function resolveTaskTarget(task: Pick<Task, 'target'>): string | null {
  const target = task.target
  if (target?.kind !== 'experiment-run' || !target.experimentId || !target.runId) return null

  return `/experiments/${encodeURIComponent(target.experimentId)}/runs/${encodeURIComponent(target.runId)}`
}
