import { lazy, Suspense } from 'react'
import { isRealApiMode } from '@/api/config'
import { PageLoading } from '@/components/page-state'

const MockPaperTradingPage = lazy(() => import('./PaperTradingMock'))
const RealPaperTradingPage = lazy(() => import('./PaperTradingReal'))

export default function PaperTradingPage() {
  // G5 /paper-trading/* 真实端点已就绪：real 模式加载基于真实 API 的页面
  // （账户 + 订单 + 对账批次展开 + 每日报告）。
  // Mock 模式继续使用 PaperTradingMock（沙箱演示数据 + 内嵌对账）。
  return (
    <Suspense fallback={<PageLoading />}>
      {isRealApiMode ? <RealPaperTradingPage /> : <MockPaperTradingPage />}
    </Suspense>
  )
}
