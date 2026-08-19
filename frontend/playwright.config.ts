import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright 配置。
 *
 * 三个 project：
 * - research-flow：mock 模式主路径 E2E（只需 vite dev server，无后端依赖）
 *   覆盖 G3 主路径：实验提交 → 运行详情 → 验证 tab → 报告 → 导出 → 审批
 * - accessibility：基于 @axe-core/playwright 的无障碍扫描（G4 验收）
 *   覆盖关键页面：首页 / 数据目录 / 实验列表 / 新建实验向导
 *
 * smoke（B2 数据集快照）由 scripts/runtime_closeout.py 编排，不走 @playwright/test，
 * 通过 npm run e2e:smoke 单独触发，需要 PostgreSQL + 后端 + Worker。
 */
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173'

// 本地 Windows 用系统 Edge 免下载 Chromium；CI(Linux) 用 playwright install 下载的 Chromium
// 注意：TRAE 沙箱也会设置 CI=true，所以用平台而非 CI 变量判断
const LOCAL_EDGE =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : undefined)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'research-flow',
      testMatch: 'e2e/research-flow.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        ...(LOCAL_EDGE
          ? { launchOptions: { executablePath: LOCAL_EDGE } }
          : {}),
      },
    },
    {
      name: 'accessibility',
      testMatch: 'e2e/accessibility.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        ...(LOCAL_EDGE
          ? { launchOptions: { executablePath: LOCAL_EDGE } }
          : {}),
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
        url: WEB_ORIGIN,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          // mock 模式：不调真实后端，主路径可独立走通
          VITE_API_MODE: 'mock',
        },
      },
})
