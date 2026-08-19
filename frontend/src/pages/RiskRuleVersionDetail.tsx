import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Descriptions, Space } from 'antd'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '@/app/AuthContext'
import {
  deprecateRiskRuleVersion,
  freezeRiskRuleVersion,
  getRiskRuleSet,
  getRiskRuleVersion,
  RESEARCH_VERSION_STATUS_LABEL,
} from '@/api/risk'
import { auditEventIdFromNavigation, createIdempotencyKey, isForbiddenError } from '@/api/research/ui'
import { ConfirmModal, CopyableId, PageHeader, StatusTag } from '@/components'
import { DisabledNotice, PageEmpty, PageError, PageForbidden, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

type LifecycleAction = 'freeze' | 'deprecate'

// oxlint-disable-next-line react/only-export-components -- exported for the route-binding contract test
export function isRiskRuleVersionRouteBindingValid(
  routeRiskRuleSetId: string,
  versionRiskRuleSetId: string,
): boolean {
  return Boolean(routeRiskRuleSetId) && routeRiskRuleSetId === versionRiskRuleSetId
}

function bp(value: number): string {
  return `${value} bp（${(value / 100).toFixed(2)}%）`
}

export default function RiskRuleVersionDetailPage() {
  const { riskRuleSetId = '', versionId = '' } = useParams()
  const location = useLocation()
  const [action, setAction] = useState<LifecycleAction | null>(null)
  const [actionKey, setActionKey] = useState(() => createIdempotencyKey('risk-lifecycle'))
  const [lastAuditId, setLastAuditId] = useState<string | null>(() => auditEventIdFromNavigation(location.state))
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const { canManageOwned } = useAuth()

  const versionQ = useQuery({ queryKey: ['riskRuleVersion', versionId], queryFn: () => getRiskRuleVersion(versionId), enabled: Boolean(versionId) })
  const ruleSetQ = useQuery({ queryKey: ['riskRuleSet', riskRuleSetId], queryFn: () => getRiskRuleSet(riskRuleSetId), enabled: Boolean(riskRuleSetId) })

  if (versionQ.isLoading || ruleSetQ.isLoading) return <PageLoading />
  const error = versionQ.error ?? ruleSetQ.error
  if (isForbiddenError(error)) return <PageForbidden description="当前身份没有风险规则版本读取权限" />
  if (error) return <PageError error={error} retry={() => { void versionQ.refetch(); void ruleSetQ.refetch() }} />
  const data = versionQ.data
  const ruleSet = ruleSetQ.data
  if (!data || !ruleSet) return <PageEmpty title="风险规则版本不存在" />

  if (!isRiskRuleVersionRouteBindingValid(riskRuleSetId, data.riskRuleSetId)) {
    return <PageError code="VERSION_CONTAINER_MISMATCH" message="该版本不属于当前风险规则集" />
  }

  const canFreeze = data.status === 'draft' && canManageOwned('risk:version:freeze', ruleSet.ownerKey)
  const canDeprecate = data.status === 'frozen' && canManageOwned('risk:version:deprecate', ruleSet.ownerKey)
  const content = data.content
  const openAction = (next: LifecycleAction) => {
    setActionKey(createIdempotencyKey(`risk-${next}`))
    setAction(next)
  }

  return (
    <div>
      <PageHeader
        parent={ruleSet.name}
        title={`风险规则版本 v${data.version}`}
        meta={[<CopyableId key="id" id={data.id} maxLength={0} />, <StatusTag key="status" status={data.status} label={RESEARCH_VERSION_STATUS_LABEL[data.status]} />, `Owner ${ruleSet.ownerKey}`]}
        extra={<Space>{canFreeze ? <Button type="primary" onClick={() => openAction('freeze')}>冻结版本</Button> : null}{canDeprecate ? <Button danger onClick={() => openAction('deprecate')}>废弃版本</Button> : null}</Space>}
      />

      {data.status === 'deprecated' ? (
        <DisabledNotice reason={data.deprecateReason ?? '该版本已废弃，历史内容仍可读取，但不能被新实验引用。'} />
      ) : data.status === 'frozen' ? (
        <Alert style={{ marginTop: 16 }} type="success" showIcon message="版本已冻结且只读" description="该版本可作为新实验风险规则引用。" />
      ) : (
        <Alert style={{ marginTop: 16 }} type="warning" showIcon message="草稿版本只读" description="冻结后才可被新实验引用。" />
      )}
      {lastAuditId ? <Alert style={{ marginTop: 12 }} type="success" showIcon message="生命周期操作已审计" description={<CopyableId id={lastAuditId} maxLength={0} />} /> : null}

      <Descriptions bordered size="small" column={2} title="版本合同" style={{ marginTop: 16 }}>
        <Descriptions.Item label="合同">{data.contractName}</Descriptions.Item>
        <Descriptions.Item label="可被新实验引用">{data.eligibleForNewExperiment ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="内容 Hash" span={2}><CopyableId id={data.contentSha256} maxLength={0} /></Descriptions.Item>
        <Descriptions.Item label="父版本">{data.parentVersionId ? <Link to={`/risk/rule-sets/${riskRuleSetId}/versions/${data.parentVersionId}`}><CopyableId id={data.parentVersionId} maxLength={18} /></Link> : '—'}</Descriptions.Item>
        <Descriptions.Item label="创建者">{data.createdByKey}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatDateTime(data.createdAt, { zone: false })}</Descriptions.Item>
        <Descriptions.Item label="备注">{data.note ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="冻结原因">{data.freezeReason ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="废弃原因">{data.deprecateReason ?? '—'}</Descriptions.Item>
      </Descriptions>

      <Descriptions bordered size="small" column={2} title="A 股日线阈值" style={{ marginTop: 20 }}>
        <Descriptions.Item label="单票上限">{bp(content.max_single_position_bp)}</Descriptions.Item>
        <Descriptions.Item label="行业上限">{bp(content.max_industry_position_bp)}</Descriptions.Item>
        <Descriptions.Item label="总敞口上限">{bp(content.max_gross_exposure_bp)}</Descriptions.Item>
        <Descriptions.Item label="集中度 HHI 上限">{bp(content.max_concentration_hhi_bp)}</Descriptions.Item>
        <Descriptions.Item label="日换手上限">{bp(content.max_daily_turnover_bp)}</Descriptions.Item>
        <Descriptions.Item label="日亏损熔断">{bp(content.daily_loss_circuit_breaker_bp)}</Descriptions.Item>
        <Descriptions.Item label="最大回撤熔断">{bp(content.max_drawdown_circuit_breaker_bp)}</Descriptions.Item>
        <Descriptions.Item label="不确定状态动作">{content.uncertain_state_action}</Descriptions.Item>
        <Descriptions.Item label="风险降低绕过开仓限制">{content.risk_reduction_bypasses_opening_limits ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="输入合同">{content.input_contract}</Descriptions.Item>
        <Descriptions.Item label="输出合同">{content.output_contract}</Descriptions.Item>
      </Descriptions>

      <DisabledNotice title="风险执行尚未开放" readOnly={false} reason="B3 只冻结确定性输入输出与阈值合同；风险执行和事件查询属于 B4/B5。" />

      <ConfirmModal
        open={Boolean(action)}
        title={action === 'deprecate' ? '废弃风险规则版本' : '冻结风险规则版本'}
        description={action === 'deprecate' ? '废弃后历史内容仍可读取，但不能用于创建新实验。' : '冻结后内容保持只读，并可用于新实验引用。'}
        confirmText={action === 'deprecate' ? '确认废弃并留痕' : '确认冻结并留痕'}
        danger
        onCancel={() => setAction(null)}
        onOk={async (reason) => {
          const result = action === 'deprecate'
            ? await deprecateRiskRuleVersion(data.id, reason, { idempotencyKey: actionKey })
            : await freezeRiskRuleVersion(data.id, reason, { idempotencyKey: actionKey })
          setLastAuditId(result.auditEventId)
          await queryClient.invalidateQueries({ queryKey: ['riskRuleVersion', versionId] })
          await queryClient.invalidateQueries({ queryKey: ['riskRuleVersions', riskRuleSetId] })
          message.success(action === 'deprecate' ? '风险规则版本已废弃' : '风险规则版本已冻结')
          return result.auditEventId
        }}
      />
    </div>
  )
}
