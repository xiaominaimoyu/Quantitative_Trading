import { lazy, Suspense } from 'react'
import { isRealApiMode } from '@/api/config'
import { PageHeader } from '@/components'
import { DisabledNotice, PageLoading } from '@/components/page-state'

const MockExperimentNewPage = lazy(() => import('./ExperimentNewMock'))

export default function ExperimentNewPage() {
  if (isRealApiMode) {
    return (
      <div>
        <PageHeader title="新建实验" subtitle="实验预注册与回测属于 B4" />
        <DisabledNotice
          title="真实实验提交尚未开放"
          readOnly={false}
          reason="B3 只提供数据、策略、模型和风险版本的引用资格；real 模式不会提交 mock 实验或回测。"
        />
      </div>
    )
  }
  return (
    <Suspense fallback={<PageLoading />}>
      <MockExperimentNewPage />
    </Suspense>
  )
}
