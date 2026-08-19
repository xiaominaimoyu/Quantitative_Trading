/**
 * AppProviders —— 全局 Provider 组合（主题 → 登录态）。
 * AntD 的 App（message/modal 上下文）在 main.tsx 中包裹于最外层。
 */

import type { ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ThemeProvider, semanticColors } from '@/theme'
import { AuthProvider } from './AuthContext'
import { QueryProvider } from './QueryProvider'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ token: { colorPrimary: semanticColors.primary } }}
    >
      <QueryProvider>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </QueryProvider>
    </ConfigProvider>
  )
}
