/**
 * AppProviders —— 全局 Provider 组合（主题 → 登录态）。
 * AntD 的 App（message/modal 上下文）在 main.tsx 中包裹于最外层。
 */

import { useMemo, type ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { ThemeProvider, useTheme } from '@/theme'
import { colorPalette, densityTokens } from '@/theme/tokens/v2'
import { AuthProvider } from './AuthContext'
import { QueryProvider } from './QueryProvider'

function ThemedConfigProvider({ children }: { children: ReactNode }) {
  const { ui, effectiveDensity } = useTheme()

  const config = useMemo(() => {
    const palette = colorPalette[ui]
    const density = densityTokens[effectiveDensity]

    return {
      locale: zhCN,
      theme: {
        algorithm: ui === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: palette.colorPrimary,
          colorSuccess: palette.colorSuccess,
          colorWarning: palette.colorWarning,
          colorError: palette.colorError,
          colorProcessing: palette.colorProcessing,
          colorBgBase: palette.bgPage,
          colorBgContainer: palette.bgContainer,
          colorBgElevated: palette.bgElevated,
          colorBorder: palette.borderBase,
          colorBorderSecondary: palette.borderStrong,
          colorText: palette.textPrimary,
          colorTextSecondary: palette.textSecondary,
          colorTextTertiary: palette.textTertiary,
          colorTextQuaternary: palette.textTertiary,
          fontSize: density.fontSize,
          borderRadius: 6,
          borderRadiusLG: 8,
          borderRadiusSM: 4,
        },
        components: {
          Table: {
            cellPaddingVertical: density === densityTokens.compact ? 8 : 12,
            cellPaddingHorizontal: density === densityTokens.compact ? 8 : 12,
          },
          Card: {
            paddingLG: density.cardPadding,
            paddingSM: density.cardPadding,
          },
          Menu: {
            itemHeight: density.menuItemHeight,
          },
          Form: {
            controlHeight: density.controlHeight,
          },
          Input: {
            controlHeight: density.controlHeight,
          },
          Button: {
            controlHeight: density.controlHeight,
          },
          Select: {
            controlHeight: density.controlHeight,
          },
        },
      },
    }
  }, [ui, effectiveDensity])

  return <ConfigProvider {...config}>{children}</ConfigProvider>
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ThemedConfigProvider>
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </ThemedConfigProvider>
    </ThemeProvider>
  )
}
