/** 数据版本详情：任务、真实 manifest、质量门和版本血缘。 */

import { useQuery } from '@tanstack/react-query'
import { Alert, Descriptions, Progress, Space, Table } from 'antd'
import { Link, useParams, useSearchParams } from 'react-router'
import { asApiError } from '@/api/client'
import {
  getDatasetVersion,
  getSnapshotTask,
  getVersionLineage,
  isDatasetVersionTerminal,
  isSnapshotTaskTerminal,
  listQualityRuns,
} from '@/api/datasets'
import { CopyableId, PageHeader, StatusTag } from '@/components'
import { PageEmpty, PageError, PageLoading } from '@/components/page-state'
import { formatCompact, formatDateTime } from '@/shared/format'

export default function VersionDetailPage() {
  const { versionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const taskFromUrl = searchParams.get('task') ?? ''

  const versionQ = useQuery({
    queryKey: ['datasetVersion', versionId],
    queryFn: () => getDatasetVersion(versionId),
    enabled: !!versionId,
    refetchInterval: (query) => {
      const value = query.state.data
      return value && isDatasetVersionTerminal(value.status) ? false : 2000
    },
  })
  const taskId = taskFromUrl || versionQ.data?.taskId || ''
  const taskQ = useQuery({
    queryKey: ['snapshotTask', taskId],
    queryFn: () => getSnapshotTask(taskId),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const value = query.state.data
      return value && isSnapshotTaskTerminal(value.status) ? false : 2000
    },
  })
  const terminal = !!versionQ.data && isDatasetVersionTerminal(versionQ.data.status)
  const qualityQ = useQuery({
    queryKey: ['datasetVersionQualityRuns', versionId],
    queryFn: () => listQualityRuns(versionId),
    enabled: !!versionId && terminal,
  })
  const lineageQ = useQuery({
    queryKey: ['datasetVersionLineage', versionId],
    queryFn: () => getVersionLineage(versionId),
    enabled: !!versionId && terminal,
  })

  if (versionQ.isLoading) return <PageLoading />
  if (versionQ.error) {
    return <PageError error={versionQ.error} retry={() => void versionQ.refetch()} />
  }
  const data = versionQ.data
  if (!data) return <PageEmpty title="数据版本不存在" />

  const taskError = asApiError(taskQ.error)
  const qualityError = asApiError(qualityQ.error)
  const lineageError = asApiError(lineageQ.error)
  const qualityRuns = [...(qualityQ.data?.items ?? [])]
  const latestQuality = qualityRuns[0]
  const qualityResults = [...(latestQuality?.results ?? [])].sort((left, right) => {
    const blocked = (value: string) => value === 'blocked' || value === 'failed' ? 0 : 1
    return blocked(left.status) - blocked(right.status)
  })
  const manifest = data.manifest

  return (
    <div>
      <PageHeader
        parent="数据目录"
        title={`版本 v${data.version}`}
        meta={[
          <CopyableId key="id" id={data.id} maxLength={0} />,
          <StatusTag key="status" status={data.status} domain="dataVersion" />,
          formatDateTime(data.createdAt, { zone: false }),
        ]}
      />

      <Alert
        style={{ marginTop: 16 }}
        type={data.eligibleForFormalUse ? 'success' : data.qualityStatus === 'blocked' ? 'error' : 'warning'}
        showIcon
        message={data.eligibleForFormalUse ? '服务端判定：具备正式使用资格' : '服务端判定：不具备正式使用资格'}
        description={
          data.gateReasons.length > 0
            ? `${data.gateDecision || 'not_eligible'}：${data.gateReasons.join('；')}`
            : data.gateDecision || data.qualitySummary || undefined
        }
      />

      {taskId ? (
        <>
          <h3 style={{ marginTop: 24, fontSize: 15 }}>创建任务</h3>
          {taskError ? (
            <Alert
              type="error"
              showIcon
              message={taskError.message}
              description={`关联编号：${taskError.requestId}`}
            />
          ) : taskQ.data ? (
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="任务 ID"><CopyableId id={taskQ.data.id} maxLength={24} /></Descriptions.Item>
              <Descriptions.Item label="状态"><StatusTag status={taskQ.data.status} domain="task" /></Descriptions.Item>
              <Descriptions.Item label="类型">{taskQ.data.taskType}</Descriptions.Item>
              <Descriptions.Item label="尝试次数">{taskQ.data.attemptCount}</Descriptions.Item>
              <Descriptions.Item label="进度" span={2}>
                <Progress percent={taskQ.data.progress} size="small" status={taskQ.data.status === 'failed' ? 'exception' : undefined} />
              </Descriptions.Item>
              {taskQ.data.errorCode ? (
                <Descriptions.Item label="任务错误" span={2}>
                  [{taskQ.data.errorCode}] {taskQ.data.errorMessage ?? '—'}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          ) : <PageLoading />}
        </>
      ) : null}

      <Descriptions
        bordered
        size="small"
        column={2}
        title="版本元数据"
        style={{ marginTop: 24 }}
      >
        <Descriptions.Item label="数据集"><CopyableId id={data.datasetId} maxLength={24} /></Descriptions.Item>
        <Descriptions.Item label="父版本">
          {data.parentVersionId
            ? <Link to={`/datasets/${data.datasetId}/versions/${data.parentVersionId}`}>{data.parentVersionId}</Link>
            : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="数据源">{data.source ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="复权口径">{data.adjustment ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="时间范围">{data.timeRange ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="市场时区">{data.timezone ?? manifest?.timezone ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="行数">{formatCompact(data.rowCount)}</Descriptions.Item>
        <Descriptions.Item label="质量状态"><StatusTag status={data.qualityStatus} domain="quality" /></Descriptions.Item>
        <Descriptions.Item label="逻辑内容哈希" span={2}>
          {data.logicalContentSha256
            ? <CopyableId id={data.logicalContentSha256} maxLength={32} />
            : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Manifest 哈希" span={2}>
          {data.manifestSha256
            ? <CopyableId id={data.manifestSha256} maxLength={32} />
            : '—'}
        </Descriptions.Item>
      </Descriptions>

      <h3 style={{ marginTop: 24, fontSize: 15 }}>Manifest</h3>
      {manifest ? (
        <>
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="Manifest 版本">{manifest.manifestVersion}</Descriptions.Item>
            <Descriptions.Item label="Schema 版本">{manifest.schemaVersion}</Descriptions.Item>
            <Descriptions.Item label="Schema 指纹" span={2}><CopyableId id={manifest.schemaFingerprint} maxLength={32} /></Descriptions.Item>
            <Descriptions.Item label="来源">{manifest.source.name}</Descriptions.Item>
            <Descriptions.Item label="来源修订">{manifest.source.revision}</Descriptions.Item>
            <Descriptions.Item label="来源许可">{manifest.source.license}</Descriptions.Item>
            <Descriptions.Item label="市场 / 周期">{manifest.market} / {manifest.frequency}</Descriptions.Item>
            <Descriptions.Item label="Manifest SHA-256" span={2}><CopyableId id={manifest.manifestSha256} maxLength={32} /></Descriptions.Item>
            <Descriptions.Item label="主键" span={2}>{manifest.primaryKey.join(', ') || '—'}</Descriptions.Item>
            <Descriptions.Item label="排序键" span={2}>{manifest.sortKey.join(', ') || '—'}</Descriptions.Item>
            <Descriptions.Item label="Parquet 写入配置" span={2}>
              {manifest.writerProfile.parquetVersion} · {manifest.writerProfile.compression}
              {manifest.writerProfile.compressionLevel == null ? '' : ` level ${manifest.writerProfile.compressionLevel}`}
              {' · '}row group {manifest.writerProfile.rowGroupSize}
              {' · '}timestamp {manifest.writerProfile.timestampUnit}
            </Descriptions.Item>
            <Descriptions.Item label="生成任务"><CopyableId id={manifest.generation.taskId} maxLength={24} /></Descriptions.Item>
            <Descriptions.Item label="代码版本">{manifest.generation.codeVersion}</Descriptions.Item>
            <Descriptions.Item label="配置哈希" span={2}><CopyableId id={manifest.generation.configHash} maxLength={32} /></Descriptions.Item>
            <Descriptions.Item label="质量报告" span={2}>
              {manifest.quality.reportArtifactId ?? '—'}
              {manifest.quality.reportSha256 ? <> · <CopyableId id={manifest.quality.reportSha256} maxLength={24} /></> : null}
            </Descriptions.Item>
          </Descriptions>
          <h4 style={{ marginTop: 16 }}>分区</h4>
          <div className="qt-table-scroll">
            <Table
              size="small"
              rowKey="relativePath"
              pagination={false}
              dataSource={manifest.partitions}
              columns={[
                { title: '相对路径', dataIndex: 'relativePath', ellipsis: true },
                {
                  title: '时间边界',
                  dataIndex: 'timeRange',
                  width: 220,
                  render: (value) => value ? `${value.start ?? '—'} ~ ${value.end ?? '—'}` : '—',
                },
                {
                  title: '标的边界',
                  dataIndex: 'symbolRange',
                  width: 180,
                  render: (value) => value ? `${value.start ?? '—'} ~ ${value.end ?? '—'}` : '—',
                },
                { title: '行数', dataIndex: 'rowCount', width: 100, render: formatCompact },
                { title: '字节', dataIndex: 'sizeBytes', width: 100, render: formatCompact },
                { title: '文件 SHA-256', dataIndex: 'fileSha256', width: 220, ellipsis: true },
              ]}
            />
          </div>
        </>
      ) : (
        <Alert type="info" showIcon message="后端尚未为此版本登记 Manifest" />
      )}

      <h3 style={{ marginTop: 24, fontSize: 15 }}>质量运行</h3>
      {qualityError ? (
        <Alert
          type="error"
          showIcon
          message={qualityError.message}
          description={`关联编号：${qualityError.requestId}`}
        />
      ) : !terminal ? (
        <Alert type="info" showIcon message="版本仍在处理，终态后加载质量报告" />
      ) : qualityQ.isLoading ? (
        <PageLoading />
      ) : qualityRuns.length === 0 ? (
        <PageEmpty title="暂无质量运行" description="未执行质量检查的版本不具备正式使用资格" />
      ) : (
        <>
          <Space style={{ marginBottom: 8 }}>
            <StatusTag status={latestQuality.status} domain="quality" />
            <span>规则集 {latestQuality.ruleSetVersion}</span>
            <span>阻断 {latestQuality.blockedCount}</span>
            <span>警告 {latestQuality.warningCount}</span>
          </Space>
          <div className="qt-table-scroll">
            <Table
              size="small"
              rowKey={(item) => `${item.ruleId}:${item.ruleVersion}`}
              pagination={false}
              dataSource={qualityResults}
              columns={[
                { title: '规则', dataIndex: 'ruleId' },
                { title: '版本', dataIndex: 'ruleVersion', width: 90 },
                { title: '严重度', dataIndex: 'severity', width: 100 },
                { title: '状态', dataIndex: 'status', width: 100, render: (value) => <StatusTag status={value} domain="quality" /> },
                { title: '数量', dataIndex: 'count', width: 90 },
                { title: '说明', dataIndex: 'message', render: (value) => value ?? '—' },
              ]}
            />
          </div>
        </>
      )}

      <h3 style={{ marginTop: 24, fontSize: 15 }}>版本血缘</h3>
      {lineageError ? (
        <Alert
          type="error"
          showIcon
          message={lineageError.message}
          description={`关联编号：${lineageError.requestId}`}
        />
      ) : !terminal ? (
        <Alert type="info" showIcon message="版本终态后加载已登记血缘" />
      ) : lineageQ.isLoading ? (
        <PageLoading />
      ) : (lineageQ.data?.nodes.length ?? 0) === 0 ? (
        <PageEmpty title="暂无已登记血缘" />
      ) : (
        <>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={lineageQ.data?.nodes ?? []}
            columns={[
              {
                title: '版本',
                dataIndex: 'version',
                render: (value, item) => (
                  <Link to={`/datasets/${item.datasetId}/versions/${item.id}`}>v{value}</Link>
                ),
              },
              { title: '版本 ID', dataIndex: 'id' },
              { title: '数据集 ID', dataIndex: 'datasetId' },
              { title: '状态', dataIndex: 'status', render: (value) => <StatusTag status={value} domain="dataVersion" /> },
            ]}
          />
          {(lineageQ.data?.edges.length ?? 0) > 0 ? (
            <Descriptions bordered size="small" column={1} title="关系" style={{ marginTop: 12 }}>
              {lineageQ.data?.edges.map((edge) => (
                <Descriptions.Item key={`${edge.parentVersionId}:${edge.childVersionId}:${edge.relationType}`} label={edge.relationType}>
                  {edge.parentVersionId} → {edge.childVersionId}
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : null}
        </>
      )}
    </div>
  )
}
