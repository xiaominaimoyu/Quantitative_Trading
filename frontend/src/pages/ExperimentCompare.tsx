import { lazy, Suspense } from 'react'
import { isRealApiMode } from '@/api/config'
import { PageLoading } from '@/components/page-state'

const MockExperimentComparePage = lazy(() => import('./ExperimentCompareMock'))
const RealExperimentComparePage = lazy(() => import('./ExperimentCompareReal'))

export default function ExperimentComparePage() {
  // B4 /experiments/{id}/runs 与 /runs/{id}/metrics 真实端点已就绪：
  // real 模式加载基于真实 API 的精简比较页（指标表 + DisabledNotice）。
  // Mock 模式继续使用 ExperimentCompareMock（叠加净值曲线 + 丰富样本）。
  return (
    <Suspense fallback={<PageLoading />}>
      {isRealApiMode ? <RealExperimentComparePage /> : <MockExperimentComparePage />}
    </Suspense>
  )
}
