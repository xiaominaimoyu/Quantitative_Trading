import { lazy, Suspense } from 'react'
import { isRealApiMode } from '@/api/config'
import { PageLoading } from '@/components/page-state'

const MockRunDetailPage = lazy(() => import('./RunDetailMock'))
const RealRunDetailPage = lazy(() => import('./RunDetailReal'))

export default function RunDetailPage() {
  // B4 /runs/{id}、/metrics、/artifacts 真实端点已就绪：real 模式加载精简版真实页面。
  // Mock 模式继续使用 RunDetailMock（净值/交易/血缘/验证窗口等丰富样本）。
  return (
    <Suspense fallback={<PageLoading />}>
      {isRealApiMode ? <RealRunDetailPage /> : <MockRunDetailPage />}
    </Suspense>
  )
}
