import assert from 'node:assert/strict'

const required = [
  'PLAYWRIGHT_MODULE',
  'WEB_ORIGIN',
  'DATASET_MARKER',
  'DATASET_ID',
  'CLEAN_SOURCE_NAME',
  'CLEAN_VERSION_ID',
  'BLOCKED_VERSION_ID',
  'BLOCKED_TASK_ID',
  'MISSING_DATASET_ID',
]
for (const name of required) assert.ok(process.env[name], `missing ${name}`)

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
// CI 用 Playwright 自带 Chromium；本地 Windows 用 Edge（由 PLAYWRIGHT_EXECUTABLE_PATH/EDGE 指定）
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.EDGE
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ['--disable-gpu', '--no-sandbox'],
})

try {
  const page = await browser.newPage()
  page.setDefaultTimeout(20_000)
  const apiRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) {
      apiRequests.push({ url: request.url(), headers: request.headers() })
    }
  })

  await page.goto(`${process.env.WEB_ORIGIN}/datasets`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: process.env.DATASET_MARKER }).click({ force: true })
  await page.waitForURL(`**/datasets/${process.env.DATASET_ID}`)
  await page.getByText(process.env.DATASET_MARKER, { exact: true }).waitFor()

  await page.getByRole('button', { name: '新建快照' }).click()
  const dialog = page.getByRole('dialog', { name: '新建数据快照' })
  await dialog.waitFor()
  await dialog.getByLabel('数据源').click()
  await page.locator('.ant-select-item-option')
    .filter({ hasText: process.env.CLEAN_SOURCE_NAME })
    .click()

  const dateInputs = dialog.locator('.ant-picker-range input')
  assert.equal(await dateInputs.count(), 2)
  const start = dateInputs.nth(0)
  const end = dateInputs.nth(1)
  await start.fill('2024-02-05')
  await start.press('Enter')
  await end.fill('2024-02-07')
  await end.press('Enter')
  await page.keyboard.press('Escape')
  await dialog.locator('textarea').fill('000001.SZ')
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '冻结并开始校验' }).click()

  await page.waitForURL(/\/datasets\/[^/]+\/versions\/[0-9a-f-]+\?task=[0-9a-f-]+/i)
  const versionId = new URL(page.url()).pathname.split('/').at(-1)
  assert.ok(versionId)
  await page.getByText('服务端判定：具备正式使用资格', { exact: true }).waitFor({ timeout: 60_000 })
  await page.getByRole('heading', { name: 'Manifest' }).waitFor()
  await page.getByText('文件 SHA-256', { exact: true }).waitFor()
  await page.getByRole('heading', { name: '质量运行' }).waitFor()
  await page.getByRole('heading', { name: '版本血缘' }).waitFor()
  await page.getByText('derived_from', { exact: true }).waitFor()

  await page.goto(
    `${process.env.WEB_ORIGIN}/datasets/${process.env.DATASET_ID}/versions/` +
      `${process.env.BLOCKED_VERSION_ID}?task=${process.env.BLOCKED_TASK_ID}`,
  )
  await page.getByText('服务端判定：不具备正式使用资格', { exact: true }).waitFor()
  await page.getByText('QUALITY_GATE_BLOCKED', { exact: false }).waitFor()

  await page.goto(`${process.env.WEB_ORIGIN}/datasets/${process.env.MISSING_DATASET_ID}`)
  await page.getByText('DATASET_NOT_FOUND', { exact: false }).waitFor()
  await page.getByText('关联编号', { exact: false }).waitFor()

  assert.ok(apiRequests.some(({ url }) => url.endsWith('/auth/dev-session')))
  assert.ok(apiRequests.some(({ url }) => url.endsWith('/auth/me')))
  assert.ok(apiRequests.some(({ url }) => url.endsWith('/versions')))
  assert.ok(apiRequests.some(({ url }) => url.includes('/quality-runs')))
  assert.ok(apiRequests.some(({ url }) => url.includes('/lineage')))
  const protectedRequests = apiRequests.filter(
    ({ url }) => !url.endsWith('/auth/dev-session'),
  )
  assert.ok(protectedRequests.every(({ headers }) => headers.authorization?.startsWith('Bearer ')))
  assert.ok(apiRequests.every(({ headers }) => headers['x-request-id']))
  console.log(`PASS browser requests=${apiRequests.length}`)
  console.log(JSON.stringify({ status: 'PASS', version_id: versionId }))
} finally {
  await browser.close()
}
