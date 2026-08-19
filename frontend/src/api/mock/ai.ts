/** AI 研究助手 Mock：仅消费已批准的结构化证据，不连接外部模型。 */

import { ApiError, generateRequestId, mockRequest, type MockRequestOptions } from '@/api/client'

export interface AiEvidence {
  id: string
  type: 'fact' | 'inference' | 'risk'
  title: string
  content: string
  source: string
  approved: boolean
}

export interface AiInteraction {
  id: string
  provider: string
  model: string
  promptVersion: string
  evidenceCount: number
  status: 'draft' | 'approved'
  createdAt: string
}

export interface AiDraft {
  id: string
  title: string
  summary: string
  evidenceIds: string[]
  caveat: string
  createdAt: string
}

const MOCK_EVIDENCE: AiEvidence[] = [
  {
    id: 'evidence-fact-001',
    type: 'fact',
    title: '样本覆盖范围',
    content: '回测覆盖 2,432 个交易日，数据截止 2026-07-31。',
    source: '数据 v3 / 运行 R-0041',
    approved: true,
  },
  {
    id: 'evidence-inference-001',
    type: 'inference',
    title: '样本外关系',
    content: '信号与未来 5 日收益呈弱正相关，区间为 0.02–0.08，非点估计。',
    source: '运行 R-0041 / 验证窗口',
    approved: true,
  },
  {
    id: 'evidence-risk-001',
    type: 'risk',
    title: '适用限制',
    content: '2020 年后效应减弱；成本加倍后增量消失，不适用于小盘股与复牌首日。',
    source: '报告 RP-0101 / 风险提示',
    approved: true,
  },
  {
    id: 'evidence-fact-002',
    type: 'fact',
    title: '批准状态',
    content: '报告 RP-0101 已由审计员批准，内容哈希为 9f2e8a1b。',
    source: '报告 RP-0101',
    approved: true,
  },
]

const MOCK_INTERACTIONS: AiInteraction[] = [
  {
    id: 'AI-0001',
    provider: '演示适配器',
    model: 'structured-summary-v1',
    promptVersion: 'evidence-summary-v1',
    evidenceCount: 3,
    status: 'approved',
    createdAt: '2026-08-07T16:20:00+08:00',
  },
]

let draftSeq = 2
let interactionSeq = 2

export function listAiEvidence(options?: MockRequestOptions): Promise<AiEvidence[]> {
  return mockRequest(() => MOCK_EVIDENCE.map((item) => ({ ...item })), options)
}

export function listAiInteractions(options?: MockRequestOptions): Promise<AiInteraction[]> {
  return mockRequest(() => MOCK_INTERACTIONS.map((item) => ({ ...item })), options)
}

export function generateAiDraft(
  evidenceIds: string[],
  options?: MockRequestOptions,
): Promise<{ draft: AiDraft; interaction: AiInteraction }> {
  return mockRequest(
    () => {
      const evidence = MOCK_EVIDENCE.filter((item) => evidenceIds.includes(item.id) && item.approved)
      if (evidence.length === 0) {
        throw new ApiError({
          code: 'AI-400',
          message: '至少选择一条已批准证据后才能生成草案',
          requestId: generateRequestId(),
        })
      }
      const now = new Date().toISOString()
      const draft: AiDraft = {
        id: `AI-DRAFT-${String(draftSeq++).padStart(4, '0')}`,
        title: '动量因子样本外表现摘要',
        summary: evidence.map((item) => item.content).join(' '),
        evidenceIds: evidence.map((item) => item.id),
        caveat: '本文本仅改写所选结构化证据，不新增事实、数值或确定性结论。',
        createdAt: now,
      }
      const interaction: AiInteraction = {
        id: `AI-${String(interactionSeq++).padStart(4, '0')}`,
        provider: '演示适配器',
        model: 'structured-summary-v1',
        promptVersion: 'evidence-summary-v1',
        evidenceCount: evidence.length,
        status: 'draft',
        createdAt: now,
      }
      MOCK_INTERACTIONS.unshift(interaction)
      return { draft, interaction: { ...interaction } }
    },
    options,
  )
}

export function approveAiDraft(
  draftId: string,
  options?: MockRequestOptions,
): Promise<{ auditId: string }> {
  return mockRequest(
    () => {
      if (!draftId) {
        throw new ApiError({
          code: 'AI-400',
          message: '草案编号不能为空',
          requestId: generateRequestId(),
        })
      }
      const interaction = MOCK_INTERACTIONS.find((item) => item.status === 'draft')
      if (interaction) interaction.status = 'approved'
      return { auditId: `AUD-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(interactionSeq++).padStart(4, '0')}` }
    },
    options,
  )
}
