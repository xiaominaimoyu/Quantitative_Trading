import { expect, test, type Page } from '@playwright/test'

const nextButtonName = /下\s*一\s*步/

function formItem(page: Page, label: string) {
  return page.locator('.ant-form-item').filter({ has: page.getByText(label, { exact: true }) }).first()
}

async function selectOptionByText(page: Page, label: string, optionText: string) {
  const combobox = formItem(page, label).getByRole('combobox').first()
  await expect(combobox).toBeVisible()
  await combobox.focus()
  await combobox.press('Enter')
  const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // AntD appends descriptive availability text to the visible option.  Match
  // the requested option label at its start instead of relying on offsets.
  const option = page
    .locator('.ant-select-item-option:visible')
    .filter({ hasText: new RegExp(`^${escaped}(?:\\s|$)`) })
  await expect(option).toHaveCount(1)
  await option.click()
}

async function selectFirstOption(page: Page, label: string) {
  const combobox = formItem(page, label).getByRole('combobox').first()
  await expect(combobox).toBeVisible()
  await combobox.focus()
  await combobox.press('Enter')
  await combobox.press('Home')
  await combobox.press('Enter')
}

async function goToNextStep(page: Page) {
  const button = page.getByRole('button', { name: nextButtonName })
  await expect(button).toBeEnabled()
  await button.click()
}

test('mock research flow reaches the retained experiment, validation, report export, and auditor approval', async ({ page }) => {
  await page.goto('/experiments/new')
  await expect(page.getByRole('heading', { name: '新建实验' })).toBeVisible()

  await formItem(page, '假设陈述').locator('textarea').fill('保留夹具的动量假设')
  await formItem(page, '失败条件').locator('textarea').fill('样本外 Sharpe 低于阈值')
  await goToNextStep(page)

  await selectOptionByText(page, '数据版本', 'ds-ashare-v3')
  await goToNextStep(page)

  await selectOptionByText(page, '策略版本', '动量轮动 · v2')
  await formItem(page, '基线模型')
    .getByRole('checkbox', { name: '买入持有 v1', exact: true })
    .first()
    .check()
  await goToNextStep(page)

  await goToNextStep(page)
  await selectFirstOption(page, '风控规则集')
  await goToNextStep(page)
  await goToNextStep(page)
  await page.getByRole('checkbox', { name: /我确认上述预注册协议完整无误/ }).check()
  await expect(page.getByText('预注册确认', { exact: true })).toBeVisible()
  await expect(page.getByText('ds-ashare-v3', { exact: true })).toBeVisible()
  await expect(page.getByText('st-momentum-v2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /提\s*交并冻结协议/ }).click()
  const duplicateDialog = page.getByRole('dialog', { name: '发现相同输入的运行' })
  await expect(duplicateDialog).toBeVisible()
  await expect(duplicateDialog.getByText(/已有运行\s*R-0041/)).toBeVisible()
  await duplicateDialog.getByRole('button', { name: '查看既有结果', exact: true }).click()
  await expect(page).toHaveURL(/\/experiments\/exp-momentum-0042\/runs\/R-0041$/)
  await expect(page.getByRole('heading', { name: /运行 R-0041/ })).toBeVisible()
  await page.getByRole('tab', { name: '验证', exact: true }).click()
  await expect(page.getByText('窗口 1 · 2021–2022', { exact: true })).toBeVisible()

  await page.goto('/experiments/exp-momentum-0042')
  await expect(page.getByRole('heading', { name: '动量因子有效性验证' })).toBeVisible()
  await page.getByRole('tab', { name: /验证运行/ }).click()
  await expect(page.getByRole('alert').getByText(/验证运行仅在 real 模式可用/)).toBeVisible()

  await page.goto('/reports')
  await expect(page.getByRole('heading', { name: '报告' })).toBeVisible()
  const reportRow = page.locator('tr.ant-table-row').filter({ hasText: '动量因子样本外验证' })
  await expect(reportRow).toHaveCount(1)
  await reportRow.click()
  await expect(page).toHaveURL(/\/reports\/RP-0101$/)
  await expect(page.getByRole('heading', { name: '动量因子样本外验证' })).toBeVisible()
  await expect(page.getByRole('button', { name: '批准报告', exact: true })).toHaveCount(0)

  const markdownDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /导\s*出/ }).click()
  await page.getByRole('menuitem', { name: /导\s*出\s*Markdown/ }).click()
  const downloaded = await markdownDownload
  expect(downloaded.suggestedFilename()).toBe('RP-0101.md')

  await page.getByRole('button', { name: /陈默\s*·\s*研究员/ }).click()
  await page.getByRole('menuitem', { name: '审计员', exact: true }).click()
  await expect(page.getByRole('button', { name: /审计员\s*·\s*审计员/ })).toBeVisible()
  await page.getByRole('link', { name: '报告', exact: true }).click()
  await expect(page).toHaveURL(/\/reports$/)
  const pendingReportRow = page.locator('tr.ant-table-row').filter({ hasText: '价值因子季度再平衡' })
  await expect(pendingReportRow).toHaveCount(1)
  await pendingReportRow.click()
  await expect(page).toHaveURL(/\/reports\/RP-0098$/)
  await expect(page.getByRole('heading', { name: '价值因子季度再平衡' })).toBeVisible()
  await expect(page.getByRole('button', { name: '批准报告', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '批准报告', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder(/请填写操作原因/).fill('mock 审核通过')
  await dialog.getByRole('button', { name: '批准并留痕', exact: true }).click()
  await expect(dialog.getByText('操作已完成', { exact: true })).toBeVisible()
})
