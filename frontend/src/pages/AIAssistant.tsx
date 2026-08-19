/** AI 研究助手：受控的结构化证据摘要演示 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, Checkbox, Descriptions, List, Space, Switch, Table, Typography } from 'antd'
import { approveAiDraft, generateAiDraft, listAiEvidence, listAiInteractions, type AiDraft } from '@/api/mock/ai'
import { ConfirmModal, CopyableId, PageHeader, StatusTag } from '@/components'
import { PageError, PageLoading } from '@/components/page-state'
import { formatDateTime } from '@/shared/format'

export default function AIAssistantPage() {
  const [enabled, setEnabled] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [draft, setDraft] = useState<AiDraft | null>(null)
  const [generating, setGenerating] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [approved, setApproved] = useState(false)
  const queryClient = useQueryClient()

  const evidenceQ = useQuery({ queryKey: ['aiEvidence'], queryFn: () => listAiEvidence() })
  const historyQ = useQuery({ queryKey: ['aiInteractions'], queryFn: () => listAiInteractions() })

  if (evidenceQ.isLoading || historyQ.isLoading) return <PageLoading rows={8} />
  if (evidenceQ.error || historyQ.error) {
    return <PageError error={evidenceQ.error ?? historyQ.error} retry={() => { void evidenceQ.refetch(); void historyQ.refetch() }} />
  }

  const evidence = evidenceQ.data ?? []
  const selectedEvidence = evidence.filter((item) => selectedIds.includes(item.id))

  const generateDraft = async () => {
    setGenerating(true)
    try {
      const result = await generateAiDraft(selectedIds)
      setDraft(result.draft)
      setApproved(false)
      await queryClient.invalidateQueries({ queryKey: ['aiInteractions'] })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="AI 研究助手"
        subtitle="只基于已批准的结构化证据生成可人工核对的研究摘要"
        extra={<Space><span>AI 功能总开关</span><Switch checked={enabled} onChange={setEnabled} /></Space>}
      />

      <Alert
        style={{ marginTop: 16 }}
        type={enabled ? 'info' : 'warning'}
        showIcon
        message={enabled ? 'AI 研究助手已启用（演示适配器）' : 'AI 研究助手当前关闭'}
        description="AI 不接收密钥、系统指令或订单接口；输出必须经过人工批准，才能进入正式报告。"
      />

      {!enabled ? (
        <Card style={{ marginTop: 16 }}>
          <Typography.Paragraph>打开上方开关后，可以从已批准证据中选择字段并生成结构化草案。</Typography.Paragraph>
          <Button type="primary" onClick={() => setEnabled(true)}>启用演示助手</Button>
        </Card>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 16 }}>
          <Card size="small" title="1. 选择已批准证据">
            <Checkbox.Group value={selectedIds} onChange={(values) => setSelectedIds(values as string[])} style={{ width: '100%' }}>
              <List
                size="small"
                dataSource={evidence}
                renderItem={(item) => (
                  <List.Item>
                    <Checkbox value={item.id} disabled={!item.approved}>
                      <Space direction="vertical" size={0}>
                        <span>{item.title}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.content} · 来源：{item.source}</Typography.Text>
                      </Space>
                    </Checkbox>
                  </List.Item>
                )}
              />
            </Checkbox.Group>
            <Button type="primary" loading={generating} disabled={selectedIds.length === 0} onClick={() => void generateDraft()} style={{ marginTop: 12 }}>
              生成结构化草案
            </Button>
          </Card>

          {draft ? (
            <Card
              size="small"
              title="2. 草案与证据对照"
              extra={approved ? <StatusTag status="approved" label="已批准" /> : <Button type="primary" onClick={() => setApproveOpen(true)}>批准草案</Button>}
            >
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="草案编号"><CopyableId id={draft.id} maxLength={0} /></Descriptions.Item>
                <Descriptions.Item label="生成时间">{formatDateTime(draft.createdAt, { zone: false })}</Descriptions.Item>
                <Descriptions.Item label="标题" span={2}>{draft.title}</Descriptions.Item>
                <Descriptions.Item label="摘要" span={2}>{draft.summary}</Descriptions.Item>
                <Descriptions.Item label="约束说明" span={2}>{draft.caveat}</Descriptions.Item>
              </Descriptions>
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
                所选证据：{selectedEvidence.map((item) => item.title).join('、')}
              </Typography.Text>
            </Card>
          ) : null}

          <Card size="small" title="3. 交互历史">
            <div className="qt-table-scroll">
              <Table
                size="small"
                rowKey="id"
                dataSource={historyQ.data ?? []}
                pagination={false}
                columns={[
                  { title: '编号', dataIndex: 'id', width: 100 },
                  { title: '提供商', dataIndex: 'provider', width: 120 },
                  { title: '模型', dataIndex: 'model' },
                  { title: '提示词版本', dataIndex: 'promptVersion', width: 160 },
                  { title: '证据数', dataIndex: 'evidenceCount', width: 80 },
                  { title: '状态', dataIndex: 'status', width: 100, render: (value) => <StatusTag status={value} label={value === 'approved' ? '已批准' : '草案'} /> },
                  { title: '时间', dataIndex: 'createdAt', width: 180, render: (value) => formatDateTime(value, { zone: false }) },
                ]}
              />
            </div>
          </Card>
        </Space>
      )}

      <ConfirmModal
        open={approveOpen}
        title="批准 AI 研究草案"
        description="批准只代表人工确认草案忠实改写了所选证据，不会自动覆盖正式报告。"
        confirmText="批准并留痕"
        onCancel={() => setApproveOpen(false)}
        onOk={async () => {
          if (!draft) return
          const result = await approveAiDraft(draft.id)
          setApproved(true)
          await queryClient.invalidateQueries({ queryKey: ['aiInteractions'] })
          return result.auditId
        }}
      />
    </div>
  )
}
