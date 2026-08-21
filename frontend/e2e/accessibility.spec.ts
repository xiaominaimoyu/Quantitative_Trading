import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const routes = ['/', '/datasets', '/experiments', '/experiments/new']

test('key mock pages have no serious or critical axe violations', async ({ page }) => {
  for (const route of routes) {
    await page.goto(route)
    await expect(page.locator('#main-content')).toBeVisible()
    await expect(page.getByRole('heading').first()).toBeVisible()

    const result = await new AxeBuilder({ page }).analyze()
    const blocking = result.violations.filter((violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
    )
    const diagnostics = blocking
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)
      .join('\n')

    expect(blocking, `${route} has serious/critical accessibility violations:\n${diagnostics}`).toEqual([])
  }
})
