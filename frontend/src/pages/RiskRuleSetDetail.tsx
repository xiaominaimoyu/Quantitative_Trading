import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Descriptions, Space, Table } from 'antd'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useAuth } from '@/app/AuthContext'
import {
  getRiskRuleSet,
  listRiskRuleVersions,
  RESEARCH_VERSION_STATUS_LABEL,
  type RiskRuleVersion,
} from '@/api/risk'
import { auditEventIdFromNavigation, isForbiddenError } from '@/api/research/ui'
import { CopyableId, PageHeader, StatusTag } from '@/components'
import RiskRuleVersionCreateModal from '@/components/research/RiskRuleVersionCreateModal'
import { PageEmpty, PageError, PageForbidden, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

export default function RiskRuleSetDetailPage() {
  const { riskRuleSetId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { message } = App.useApp()
  const { canManageOwned } = useAuth()
  const [source, setSource] = useState<RiskRuleVersion | null>(null)
  const [createInitial, setCreateInitial] = useState(false)
  const [lastAuditId, setLastAuditId] = useState<string | null>(() => auditEventIdFromNavigation(location.state))

  const ruleSetQ = useQuery({ queryKey: ['riskRuleSet', riskRuleSetId], queryFn: () => getRiskRuleSet(riskRuleSetId), enabled: Boolean(riskRuleSetId) })
  const versionsQ = useQuery({ queryKey: ['riskRuleVersions', riskRuleSetId], queryFn: () => listRiskRuleVersions(riskRuleSetId), enabled: Boolean(riskRuleSetId) })

  if (ruleSetQ.isLoading || versionsQ.isLoading) return <PageLoading />
  const error = ruleSetQ.error ?? versionsQ.error
  if (isForbiddenError(error)) return <PageForbidden description="当前身份没有风险规则读取权限" />
  if (error) return <PageError error={error} retry={() => { void ruleSetQ.refetch(); void versionsQ.refetch() }} />
  const ruleSet = ruleSetQ.data
  if (!ruleSet) return <PageEmpty title="风险规则集不存在" />
  const versions = versionsQ.data?.items ?? []
  const canCreateVersion = canManageOwned('risk:version:create', ruleSet.ownerKey)

  return (
    <div>
      <PageHeader
        parent="风险管理"
        title={ruleSet.name}
        subtitle={ruleSet.description ?? '未填写描述'}
        meta={[<CopyableId key="id" id={ruleSet.id} maxLength={0} />, `Owner ${ruleSet.ownerKey}`, `slug ${ruleSet.slug}`]}
      />
      {lastAuditId ? <Alert style={{ marginTop: 16 }} type="success" showIcon message="版本创建完成" description={<CopyableId id={lastAuditId} maxLength={0} />} /> : null}
      {!canCreateVersion ? <Alert style={{ marginTop: 16 }} type="info" showIcon message="当前身份只能读取此规则集" description="创建子版本需要 risk:version:create 且必须是 owner；管理员可跨 owner 操作。" /> : null}
      <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
        <Descriptions.Item label="版本数">{ruleSet.versionCount}</Descriptions.Item>
        <Descriptions.Item label="最新状态">{ruleSet.latestVersionStatus ? RESEARCH_VERSION_STATUS_LABEL[ruleSet.latestVersionStatus] : '暂无版本'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatDateTime(ruleSet.createdAt, { zone: false })}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{formatDateTime(ruleSet.updatedAt, { zone: false })}</Descriptions.Item>
      </Descriptions>

      <h3 style={{ marginTop: 24, fontSize: 15 }}>版本列表</h3>
      {versions.length === 0 ? (
        <PageEmpty
          title="暂无风险规则版本"
          description="创建首个严格 A 股日线风险草稿；冻结后才能作为后续版本父节点。"
          action={canCreateVersion ? <Button type="primary" onClick={() => setCreateInitial(true)}>创建首个版本</Button> : undefined}
        />
      ) : (
        <div className="qt-table-scroll">
          <Table
            size="small"
            rowKey="id"
            dataSource={versions}
            pagination={false}
            columns={[
              { title: '版本', dataIndex: 'version', width: 80, render: (value, row) => <Link to={`/risk/rule-sets/${riskRuleSetId}/versions/${row.id}`}>v{value}</Link> },
              { title: '状态', dataIndex: 'status', width: 110, render: (_, row) => <StatusTag status={row.status} label={RESEARCH_VERSION_STATUS_LABEL[row.status]} /> },
              { title: '父版本', dataIndex: 'parentVersionId', render: (value) => value ? <CopyableId id={value} maxLength={18} /> : '—' },
              { title: '内容 Hash', dataIndex: 'contentSha256', render: (value) => <CopyableId id={value} maxLength={18} /> },
              { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (value) => formatDateTime(value, { zone: false }) },
              {
                title: '操作',
                width: 180,
                render: (_, row) => (
                  <Space size={0}>
                    <Button type="link" size="small" onClick={() => navigate(`/risk/rule-sets/${riskRuleSetId}/versions/${row.id}`)}>查看</Button>
                    {row.status === 'frozen' && canCreateVersion ? <Button type="link" size="small" onClick={() => setSource(row)}>基于此新建</Button> : null}
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}

      <RiskRuleVersionCreateModal
        open={Boolean(source) || createInitial}
        riskRuleSetId={riskRuleSetId}
        parent={source}
        initial={createInitial}
        onCancel={() => { setSource(null); setCreateInitial(false) }}
        onCreated={async (result) => {
          setLastAuditId(result.auditEventId)
          setSource(null)
          setCreateInitial(false)
          await versionsQ.refetch()
          await ruleSetQ.refetch()
          message.success('风险规则草稿版本已创建')
          navigate(`/risk/rule-sets/${riskRuleSetId}/versions/${result.item.id}`, { state: { auditEventId: result.auditEventId } })
        }}
      />
    </div>
  )
}
