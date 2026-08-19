import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Descriptions, Space } from 'antd'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '@/app/AuthContext'
import {
  deprecateStrategyVersion,
  freezeStrategyVersion,
  getStrategy,
  getStrategyVersion,
  RESEARCH_VERSION_STATUS_LABEL,
} from '@/api/strategies'
import { auditEventIdFromNavigation, createIdempotencyKey, isForbiddenError } from '@/api/research/ui'
import { ConfirmModal, CopyableId, PageHeader, StatusTag } from '@/components'
import { DisabledNotice, PageEmpty, PageError, PageForbidden, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

type LifecycleAction = 'freeze' | 'deprecate'

// oxlint-disable-next-line react/only-export-components -- exported for the route-binding contract test
export function isStrategyVersionRouteBindingValid(
  routeStrategyId: string,
  versionStrategyId: string,
): boolean {
  return Boolean(routeStrategyId) && routeStrategyId === versionStrategyId
}

export default function StrategyVersionDetailPage() {
  const { strategyId = '', versionId = '' } = useParams()
  const location = useLocation()
  const [action, setAction] = useState<LifecycleAction | null>(null)
  const [actionKey, setActionKey] = useState(() => createIdempotencyKey('strategy-lifecycle'))
  const [lastAuditId, setLastAuditId] = useState<string | null>(() => auditEventIdFromNavigation(location.state))
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const { canManageOwned } = useAuth()

  const versionQ = useQuery({
    queryKey: ['strategyVersion', versionId],
    queryFn: () => getStrategyVersion(versionId),
    enabled: Boolean(versionId),
  })
  const strategyQ = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => getStrategy(strategyId),
    enabled: Boolean(strategyId),
  })

  if (versionQ.isLoading || strategyQ.isLoading) return <PageLoading />
  const error = versionQ.error ?? strategyQ.error
  if (isForbiddenError(error)) return <PageForbidden description="当前身份没有策略版本读取权限" />
  if (error) return <PageError error={error} retry={() => { void versionQ.refetch(); void strategyQ.refetch() }} />
  const data = versionQ.data
  const strategy = strategyQ.data
  if (!data || !strategy) return <PageEmpty title="策略版本不存在" />

  if (!isStrategyVersionRouteBindingValid(strategyId, data.strategyId)) {
    return <PageError code="VERSION_CONTAINER_MISMATCH" message="该版本不属于当前策略" />
  }

  const canFreeze = data.status === 'draft' && canManageOwned('strategy:version:freeze', strategy.ownerKey)
  const canDeprecate = data.status === 'frozen' && canManageOwned('strategy:version:deprecate', strategy.ownerKey)
  const content = data.content

  const openAction = (next: LifecycleAction) => {
    setActionKey(createIdempotencyKey(`strategy-${next}`))
    setAction(next)
  }

  return (
    <div>
      <PageHeader
        parent={strategy.name}
        title={`策略版本 v${data.version}`}
        meta={[
          <CopyableId key="id" id={data.id} maxLength={0} />,
          <StatusTag key="status" status={data.status} label={RESEARCH_VERSION_STATUS_LABEL[data.status]} />,
          `Owner ${strategy.ownerKey}`,
        ]}
        extra={(
          <Space>
            {canFreeze ? <Button type="primary" onClick={() => openAction('freeze')}>冻结版本</Button> : null}
            {canDeprecate ? <Button danger onClick={() => openAction('deprecate')}>废弃版本</Button> : null}
          </Space>
        )}
      />

      {data.status === 'deprecated' ? (
        <DisabledNotice reason={data.deprecateReason ?? '该版本已废弃，历史内容仍可读取，但不能被新实验引用。'} />
      ) : data.status === 'frozen' ? (
        <Alert style={{ marginTop: 16 }} type="success" showIcon message="版本已冻结且只读" description="当前版本可作为新实验引用；修改参数必须创建新的子版本。" />
      ) : (
        <Alert style={{ marginTop: 16 }} type="warning" showIcon message="草稿版本只读" description="B3 版本内容创建后不可原地修改；冻结后才可被新实验引用。" />
      )}
      {lastAuditId ? (
        <Alert style={{ marginTop: 12 }} type="success" showIcon message="生命周期操作已审计" description={<CopyableId id={lastAuditId} maxLength={0} />} />
      ) : null}

      <Descriptions bordered size="small" column={2} title="版本合同" style={{ marginTop: 16 }}>
        <Descriptions.Item label="合同">{data.contractName}</Descriptions.Item>
        <Descriptions.Item label="可被新实验引用">{data.eligibleForNewExperiment ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="内容 Hash" span={2}><CopyableId id={data.contentSha256} maxLength={0} /></Descriptions.Item>
        <Descriptions.Item label="父版本">
          {data.parentVersionId ? <Link to={`/strategies/${strategyId}/versions/${data.parentVersionId}`}><CopyableId id={data.parentVersionId} maxLength={18} /></Link> : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="创建者">{data.createdByKey}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatDateTime(data.createdAt, { zone: false })}</Descriptions.Item>
        <Descriptions.Item label="备注">{data.note ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="冻结时间">{data.frozenAt ? formatDateTime(data.frozenAt, { zone: false }) : '—'}</Descriptions.Item>
        <Descriptions.Item label="冻结者">{data.frozenByKey ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="废弃时间">{data.deprecatedAt ? formatDateTime(data.deprecatedAt, { zone: false }) : '—'}</Descriptions.Item>
        <Descriptions.Item label="废弃者">{data.deprecatedByKey ?? '—'}</Descriptions.Item>
      </Descriptions>

      <Descriptions bordered size="small" column={2} title="横截面动量内容" style={{ marginTop: 20 }}>
        <Descriptions.Item label="资产池">{content.universe}</Descriptions.Item>
        <Descriptions.Item label="频率">{content.frequency}</Descriptions.Item>
        <Descriptions.Item label="信号价格">{content.signal_price}</Descriptions.Item>
        <Descriptions.Item label="信号复权">{content.signal_adjustment}</Descriptions.Item>
        <Descriptions.Item label="回看交易日">{content.lookback_trading_days}</Descriptions.Item>
        <Descriptions.Item label="选取数量">{content.select_top_n}</Descriptions.Item>
        <Descriptions.Item label="再平衡间隔">{content.rebalance_every_trading_days} 个交易日</Descriptions.Item>
        <Descriptions.Item label="权重方式">{content.weighting}</Descriptions.Item>
        <Descriptions.Item label="决策时点">{content.decision_timing}</Descriptions.Item>
        <Descriptions.Item label="最早执行">{content.earliest_execution}</Descriptions.Item>
        <Descriptions.Item label="输出合同">{content.output_contract}</Descriptions.Item>
        <Descriptions.Item label="仅多头">{content.long_only ? '是' : '否'}</Descriptions.Item>
      </Descriptions>

      <DisabledNotice
        title="实验与运行血缘尚未开放"
        readOnly={false}
        reason="B4 才会创建实验、回测和引用运行；B3 不展示伪造 lineage 或 run。"
      />

      <ConfirmModal
        open={Boolean(action)}
        title={action === 'deprecate' ? '废弃策略版本' : '冻结策略版本'}
        description={action === 'deprecate'
          ? '废弃后历史内容仍可读取，但不能用于创建新实验。'
          : '冻结后内容保持只读，并可用于新实验引用。'}
        confirmText={action === 'deprecate' ? '确认废弃并留痕' : '确认冻结并留痕'}
        danger
        onCancel={() => setAction(null)}
        onOk={async (reason) => {
          const result = action === 'deprecate'
            ? await deprecateStrategyVersion(data.id, reason, { idempotencyKey: actionKey })
            : await freezeStrategyVersion(data.id, reason, { idempotencyKey: actionKey })
          setLastAuditId(result.auditEventId)
          await queryClient.invalidateQueries({ queryKey: ['strategyVersion', versionId] })
          await queryClient.invalidateQueries({ queryKey: ['strategyVersions', strategyId] })
          message.success(action === 'deprecate' ? '策略版本已废弃' : '策略版本已冻结')
          return result.auditEventId
        }}
      />
    </div>
  )
}
