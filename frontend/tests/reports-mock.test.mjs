import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('mock report detail preserves approved history and enforces the approval lifecycle', async () => {
  const originalApiMode = process.env.VITE_API_MODE
  process.env.VITE_API_MODE = 'mock'
  let server

  try {
    server = await createServer({
      root: frontendRoot,
      server: { middlewareMode: true },
      appType: 'custom',
      logLevel: 'silent',
    })
    const reports = await server.ssrLoadModule('/src/api/reports.ts')

    const approvedHistory = await reports.getReport('RP-0101')
    assert.equal(approvedHistory.report.status, 'approved')
    assert.equal(approvedHistory.report.approvedByKey, '审计员')
    assert.equal(approvedHistory.report.approvedAt, '2026-08-05T15:00:00+08:00')

    const pending = await reports.getReport('RP-0098')
    assert.equal(pending.report.status, 'submitted')

    await assert.rejects(
      () => reports.reportAction('RP-0101', 'approve', '已批准历史不可重复批准', 'reports-mock-rp-0101'),
      (error) => error?.code === 'RPT-409',
    )

    const action = await reports.reportAction('RP-0098', 'approve', '审计员确认研究报告', 'reports-mock-rp-0098')
    assert.equal(action.report.status, 'approved')
    assert.equal(typeof action.auditEventId, 'string')
    assert.ok(action.auditEventId)

    const approvedPending = await reports.getReport('RP-0098')
    assert.equal(approvedPending.report.status, 'approved')

    await assert.rejects(
      () => reports.reportAction('RP-0098', 'approve', '重复批准应被拒绝', 'reports-mock-rp-0098-repeat'),
      (error) => error?.code === 'RPT-409',
    )
  } finally {
    if (server) await server.close()
    if (originalApiMode === undefined) delete process.env.VITE_API_MODE
    else process.env.VITE_API_MODE = originalApiMode
  }
})
