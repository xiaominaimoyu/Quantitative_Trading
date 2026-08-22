/**
 * 令牌对比度审查脚本
 *
 * 扫描全主题（dark/light × normal/colorblind × compact/comfortable）
 * 所有文本/图标对背景的对比度，WCAG 2.1 AA：
 *   正文 ≥ 4.5:1，大字号/图标 ≥ 3:1
 *
 * 用法：node --import tsx scripts/audit-tokens.ts
 */

import { colorPalette, marketColors } from '../src/theme/tokens/v2'

interface AuditResult {
  theme: string
  fg: string
  bg: string
  ratio: number
  pass: boolean
  context: string
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbaToRgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return hexToRgb(s)
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const cs = c / 255
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(rgbaToRgb(fg))
  const l2 = relativeLuminance(rgbaToRgb(bg))
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

function audit(): AuditResult[] {
  const results: AuditResult[] = []

  for (const ui of ['dark', 'light'] as const) {
    const palette = colorPalette[ui]
    const themeLabel = ui

    // 正文文本对容器底色
    results.push({
      theme: themeLabel,
      fg: palette.textPrimary,
      bg: palette.bgContainer,
      ratio: contrastRatio(palette.textPrimary, palette.bgContainer),
      pass: contrastRatio(palette.textPrimary, palette.bgContainer) >= 4.5,
      context: 'text-primary on bg-container (正文)',
    })

    // 次要文本对容器底色
    results.push({
      theme: themeLabel,
      fg: palette.textSecondary,
      bg: palette.bgContainer,
      ratio: contrastRatio(palette.textSecondary, palette.bgContainer),
      pass: contrastRatio(palette.textSecondary, palette.bgContainer) >= 4.5,
      context: 'text-secondary on bg-container (次要)',
    })

    // 辅助文本对容器底色（大字号/图标 3:1）
    results.push({
      theme: themeLabel,
      fg: palette.textTertiary,
      bg: palette.bgContainer,
      ratio: contrastRatio(palette.textTertiary, palette.bgContainer),
      pass: contrastRatio(palette.textTertiary, palette.bgContainer) >= 3,
      context: 'text-tertiary on bg-container (辅助/图标)',
    })

    // 主色对容器底色
    results.push({
      theme: themeLabel,
      fg: palette.colorPrimary,
      bg: palette.bgContainer,
      ratio: contrastRatio(palette.colorPrimary, palette.bgContainer),
      pass: contrastRatio(palette.colorPrimary, palette.bgContainer) >= 4.5,
      context: 'color-primary on bg-container (链接/主操作)',
    })

    // 语义色对容器底色
    for (const [name, color] of [
      ['success', palette.colorSuccess],
      ['warning', palette.colorWarning],
      ['error', palette.colorError],
      ['processing', palette.colorProcessing],
    ] as const) {
      results.push({
        theme: themeLabel,
        fg: color,
        bg: palette.bgContainer,
        ratio: contrastRatio(color, palette.bgContainer),
        pass: contrastRatio(color, palette.bgContainer) >= 3,
        context: `color-${name} on bg-container (状态图标)`,
      })
    }

    // 行情色对容器底色
    for (const mk of ['normal', 'colorblind'] as const) {
      const mc = marketColors[ui][mk]
      results.push({
        theme: `${themeLabel}/${mk}`,
        fg: mc.up,
        bg: palette.bgContainer,
        ratio: contrastRatio(mc.up, palette.bgContainer),
        pass: contrastRatio(mc.up, palette.bgContainer) >= 3,
        context: `market-up on bg-container`,
      })
      results.push({
        theme: `${themeLabel}/${mk}`,
        fg: mc.down,
        bg: palette.bgContainer,
        ratio: contrastRatio(mc.down, palette.bgContainer),
        pass: contrastRatio(mc.down, palette.bgContainer) >= 3,
        context: `market-down on bg-container`,
      })
    }
  }

  return results
}

const results = audit()
const failures = results.filter((r) => !r.pass)

console.log('=== 令牌对比度审查 ===')
console.log(`总检查项：${results.length}`)
console.log(`通过：${results.length - failures.length}`)
console.log(`失败：${failures.length}`)

if (failures.length > 0) {
  console.log('\n--- 失败项 ---')
  for (const f of failures) {
    console.log(
      `  [${f.theme}] ${f.context}: ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)} (需要 ${
        f.context.includes('图标') || f.context.includes('辅助') ? '3.0' : '4.5'
      })`,
    )
  }
  process.exit(1)
} else {
  console.log('\n✓ 全部通过')
  process.exit(0)
}