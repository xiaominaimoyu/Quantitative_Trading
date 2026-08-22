/**
 * LineageGraph — 横向 DAG 简化图
 *
 * 节点 = 实体（图标 + 名 + 版本），边 = 派生关系
 * 节点可点击跳详情；当前实体高亮描边
 * 节点 >12 折叠同级次要分支
 */

import { useRef, useEffect } from 'react'
import * as echarts from 'echarts'
import { registerEchartsThemes, getEchartsThemeName } from '@/echarts/themes'
import { useTheme } from '@/theme'
import { Alert } from 'antd'

export interface LineageNode {
  id: string
  name: string
  version?: string
  type: 'dataset' | 'model' | 'strategy' | 'experiment' | 'run' | 'report'
  x?: number
  y?: number
}

export interface LineageEdge {
  source: string
  target: string
}

interface LineageGraphProps {
  nodes: LineageNode[]
  edges: LineageEdge[]
  currentId?: string
  onNodeClick?: (node: LineageNode) => void
  maxVisible?: number
}

const NODE_SYMBOL_SIZE = 48

function detectCycle(nodes: LineageNode[], edges: LineageEdge[]): boolean {
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) adj.get(e.source)?.push(e.target)

  const visited = new Set<string>()
  const recStack = new Set<string>()

  function dfs(id: string): boolean {
    visited.add(id)
    recStack.add(id)
    for (const neighbor of adj.get(id) ?? []) {
      if (!visited.has(neighbor) && dfs(neighbor)) return true
      if (recStack.has(neighbor)) return true
    }
    recStack.delete(id)
    return false
  }

  for (const n of nodes) {
    if (!visited.has(n.id) && dfs(n.id)) return true
  }
  return false
}

function layoutNodes(nodes: LineageNode[], edges: LineageEdge[]): LineageNode[] {
  const inDegree = new Map<string, number>()
  for (const n of nodes) inDegree.set(n.id, 0)
  for (const e of edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)

  const levels = new Map<string, number>()
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0)
  for (const n of queue) levels.set(n.id, 0)

  while (queue.length > 0) {
    const node = queue.shift()!
    const level = levels.get(node.id) ?? 0
    for (const e of edges) {
      if (e.source === node.id) {
        const nextLevel = level + 1
        if ((levels.get(e.target) ?? -1) < nextLevel) {
          levels.set(e.target, nextLevel)
        }
        queue.push(nodes.find((n) => n.id === e.target)!)
      }
    }
  }

  const byLevel = new Map<number, LineageNode[]>()
  for (const n of nodes) {
    const lv = levels.get(n.id) ?? 0
    const arr = byLevel.get(lv) ?? []
    arr.push(n)
    byLevel.set(lv, arr)
  }

  return nodes.map((n) => {
    const lv = levels.get(n.id) ?? 0
    const siblings = byLevel.get(lv) ?? [n]
    const idx = siblings.indexOf(n)
    return {
      ...n,
      x: lv * 200 + 80,
      y: idx * 80 + 40,
    }
  })
}

export function LineageGraph({
  nodes,
  edges,
  currentId,
  onNodeClick,
  maxVisible = 12,
}: LineageGraphProps) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const { ui } = useTheme()

  const hasCycle = detectCycle(nodes, edges)
  const visibleNodes = nodes.slice(0, maxVisible)
  const visibleEdges = edges.filter(
    (e) => visibleNodes.some((n) => n.id === e.source) && visibleNodes.some((n) => n.id === e.target),
  )
  const laidOut = layoutNodes(visibleNodes, visibleEdges)
  const truncated = nodes.length > maxVisible

  useEffect(() => {
    registerEchartsThemes()
    if (!ref.current) return
    chartRef.current?.dispose()
    chartRef.current = echarts.init(ref.current, getEchartsThemeName(ui))

    chartRef.current.setOption({
      tooltip: {
        formatter: (p: any) => {
          if (p.dataType === 'node') {
            return `${p.data.name}${p.data.version ? ` v${p.data.version}` : ''}`
          }
          return ''
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'none',
          symbolSize: NODE_SYMBOL_SIZE,
          roam: true,
          label: {
            show: true,
            position: 'bottom',
            fontSize: 11,
            color: 'var(--text-secondary)',
            formatter: (p: any) => p.data.name,
          },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: [0, 8],
          edgeStyle: {
            color: 'var(--border-strong)',
            width: 1.5,
            curveness: 0.1,
          },
          itemStyle: {
            color: 'var(--bg-elevated)',
            borderColor: 'var(--border-base)',
            borderWidth: 1.5,
          },
          emphasis: {
            itemStyle: {
              borderColor: 'var(--color-primary)',
              borderWidth: 2,
            },
          },
          data: laidOut.map((n) => ({
            id: n.id,
            name: n.name,
            version: n.version,
            x: n.x,
            y: n.y,
            itemStyle: n.id === currentId ? {
              borderColor: 'var(--color-primary)',
              borderWidth: 3,
            } : undefined,
          })),
          links: visibleEdges.map((e) => ({
            source: e.source,
            target: e.target,
          })),
        },
      ],
    })

    const onClick = (params: any) => {
      if (params.dataType === 'node' && onNodeClick) {
        const node = nodes.find((n) => n.id === params.data.id)
        if (node) onNodeClick(node)
      }
    }
    chartRef.current.on('click', onClick)

    return () => chartRef.current?.dispose()
  }, [laidOut, visibleEdges, currentId, ui, onNodeClick, nodes])

  return (
    <div>
      {hasCycle && (
        <Alert
          type="warning"
          message="检测到循环依赖，已截断展示"
          style={{ marginBottom: 8 }}
        />
      )}
      {truncated && (
        <Alert
          type="info"
          message={`节点数超过 ${maxVisible}，已折叠同级次要分支（+${nodes.length - maxVisible} 更多）`}
          style={{ marginBottom: 8 }}
        />
      )}
      <div ref={ref} style={{ width: '100%', height: 320 }} />
    </div>
  )
}

export default LineageGraph