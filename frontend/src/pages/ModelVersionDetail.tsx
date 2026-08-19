import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Descriptions, Space } from 'antd'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '@/app/AuthContext'
import {
  deprecateModelVersion,
  freezeModelVersion,
  getModel,
  getModelVersion,
  RESEARCH_VERSION_STATUS_LABEL,
} from '@/api/models'
import { auditEventIdFromNavigation, createIdempotencyKey, isForbiddenError } from '@/api/research/ui'
import { ConfirmModal, CopyableId, PageHeader, StatusTag } from '@/components'
import { DisabledNotice, PageEmpty, PageError, PageForbidden, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

type LifecycleAction = 'freeze' | 'deprecate'

// oxlint-disable-next-line react/only-export-components -- exported for the route-binding contract test
export function isModelVersionRouteBindingValid(
  routeModelId: string,
  versionModelId: string,
): boolean {
  return Boolean(routeModelId) && routeModelId === versionModelId
}

export default function ModelVersionDetailPage() {
  const { modelId = '', versionId = '' } = useParams()
  const location = useLocation()
  const [action, setAction] = useState<LifecycleAction | null>(null)
  const [actionKey, setActionKey] = useState(() => createIdempotencyKey('model-lifecycle'))
  const [lastAuditId, setLastAuditId] = useState<string | null>(() => auditEventIdFromNavigation(location.state))
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const { canManageOwned } = useAuth()

  const versionQ = useQuery({ queryKey: ['modelVersion', versionId], queryFn: () => getModelVersion(versionId), enabled: Boolean(versionId) })
  const modelQ = useQuery({ queryKey: ['model', modelId], queryFn: () => getModel(modelId), enabled: Boolean(modelId) })

  if (versionQ.isLoading || modelQ.isLoading) return <PageLoading />
  const error = versionQ.error ?? modelQ.error
  if (isForbiddenError(error)) return <PageForbidden description="当前身份没有模型版本读取权限" />
  if (error) return <PageError error={error} retry={() => { void versionQ.refetch(); void modelQ.refetch() }} />
  const data = versionQ.data
  const model = modelQ.data
  if (!data || !model) return <PageEmpty title="模型版本不存在" />

  if (!isModelVersionRouteBindingValid(modelId, data.modelId)) {
    return <PageError code="VERSION_CONTAINER_MISMATCH" message="该版本不属于当前模型" />
  }

  const canFreeze = data.status === 'draft' && canManageOwned('model:version:freeze', model.ownerKey)
  const canDeprecate = data.status === 'frozen' && canManageOwned('model:version:deprecate', model.ownerKey)
  const content = data.content
  const openAction = (next: LifecycleAction) => {
    setActionKey(createIdempotencyKey(`model-${next}`))
    setAction(next)
  }

  return (
    <div>
      <PageHeader
        parent={model.name}
        title={`模型版本 v${data.version}`}
        meta={[<CopyableId key="id" id={data.id} maxLength={0} />, <StatusTag key="status" status={data.status} label={RESEARCH_VERSION_STATUS_LABEL[data.status]} />, `Owner ${model.ownerKey}`]}
        extra={<Space>{canFreeze ? <Button type="primary" onClick={() => openAction('freeze')}>冻结版本</Button> : null}{canDeprecate ? <Button danger onClick={() => openAction('deprecate')}>废弃版本</Button> : null}</Space>}
      />

      {data.status === 'deprecated' ? (
        <DisabledNotice reason={data.deprecateReason ?? '该版本已废弃，历史内容仍可读取，但不能被新实验引用。'} />
      ) : data.status === 'frozen' ? (
        <Alert style={{ marginTop: 16 }} type="success" showIcon message="版本已冻结且只读" description="该版本是无预测基线元数据，可被新实验引用。" />
      ) : (
        <Alert style={{ marginTop: 16 }} type="warning" showIcon message="草稿版本只读" description="冻结后才可被新实验引用。" />
      )}
      {lastAuditId ? <Alert style={{ marginTop: 12 }} type="success" showIcon message="生命周期操作已审计" description={<CopyableId id={lastAuditId} maxLength={0} />} /> : null}

      <Descriptions bordered size="small" column={2} title="版本合同" style={{ marginTop: 16 }}>
        <Descriptions.Item label="合同">{data.contractName}</Descriptions.Item>
        <Descriptions.Item label="可被新实验引用">{data.eligibleForNewExperiment ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="内容 Hash" span={2}><CopyableId id={data.contentSha256} maxLength={0} /></Descriptions.Item>
        <Descriptions.Item label="父版本">{data.parentVersionId ? <Link to={`/models/${modelId}/versions/${data.parentVersionId}`}><CopyableId id={data.parentVersionId} maxLength={18} /></Link> : '—'}</Descriptions.Item>
        <Descriptions.Item label="创建者">{data.createdByKey}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatDateTime(data.createdAt, { zone: false })}</Descriptions.Item>
        <Descriptions.Item label="备注">{data.note ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="冻结原因">{data.freezeReason ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="废弃原因">{data.deprecateReason ?? '—'}</Descriptions.Item>
      </Descriptions>

      <Descriptions bordered size="small" column={2} title="无预测基线元数据" style={{ marginTop: 20 }}>
        <Descriptions.Item label="模型类型">{content.model_kind}</Descriptions.Item>
        <Descriptions.Item label="用途">{content.purpose}</Descriptions.Item>
        <Descriptions.Item label="资产池">{content.universe}</Descriptions.Item>
        <Descriptions.Item label="频率">{content.frequency}</Descriptions.Item>
        <Descriptions.Item label="需要训练">{content.requires_training ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="随机化">{content.randomized ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="预测期">{content.prediction_horizon_trading_days ?? '不适用'}</Descriptions.Item>
        <Descriptions.Item label="需要制品">{content.artifact_required ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="实现引用">{content.implementation_ref}</Descriptions.Item>
        <Descriptions.Item label="来源引用">{content.source_ref}</Descriptions.Item>
        <Descriptions.Item label="许可证">{content.license_ref}</Descriptions.Item>
      </Descriptions>

      <DisabledNotice title="训练与运行尚未开放" readOnly={false} reason="B3 只注册无预测模型元数据；训练、artifact 和运行血缘属于后续阶段。" />

      <ConfirmModal
        open={Boolean(action)}
        title={action === 'deprecate' ? '废弃模型版本' : '冻结模型版本'}
        description={action === 'deprecate' ? '废弃后历史内容仍可读取，但不能用于创建新实验。' : '冻结后内容保持只读，并可用于新实验引用。'}
        confirmText={action === 'deprecate' ? '确认废弃并留痕' : '确认冻结并留痕'}
        danger
        onCancel={() => setAction(null)}
        onOk={async (reason) => {
          const result = action === 'deprecate'
            ? await deprecateModelVersion(data.id, reason, { idempotencyKey: actionKey })
            : await freezeModelVersion(data.id, reason, { idempotencyKey: actionKey })
          setLastAuditId(result.auditEventId)
          await queryClient.invalidateQueries({ queryKey: ['modelVersion', versionId] })
          await queryClient.invalidateQueries({ queryKey: ['modelVersions', modelId] })
          message.success(action === 'deprecate' ? '模型版本已废弃' : '模型版本已冻结')
          return result.auditEventId
        }}
      />
    </div>
  )
}
