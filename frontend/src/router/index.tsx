/**
 * 路由定义（对齐设计文档 §4.2 路由地图）。
 *
 * 约定：
 * - 页面级组件一律 default export，放入 pages/；
 * - 面包屑由 handle.crumb(params) 贡献（AppLayout 汇总展示），
 *   crumb 项带 path 时渲染为链接，末项渲染为纯文本；
 * - 布局统一由 AppLayout（layouts/AppLayout）包裹；
 * - 筛选项 / 分页 / 视图模式由页面写入 URL query（页面可分享、可刷新恢复）。
 */

import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import AppLayout from '@/layouts/AppLayout'

import DashboardPage from '@/pages/Dashboard'
import DatasetListPage from '@/pages/DatasetList'
import DatasetDetailPage from '@/pages/DatasetDetail'
import VersionListPage from '@/pages/VersionList'
import VersionDetailPage from '@/pages/VersionDetail'
import StrategyListPage from '@/pages/StrategyList'
import StrategyDetailPage from '@/pages/StrategyDetail'
import StrategyVersionDetailPage from '@/pages/StrategyVersionDetail'
import ModelDetailPage from '@/pages/ModelDetail'
import ModelVersionDetailPage from '@/pages/ModelVersionDetail'
import ExperimentListPage from '@/pages/ExperimentList'
import ExperimentNewPage from '@/pages/ExperimentNew'
import ExperimentDetailPage from '@/pages/ExperimentDetail'
import ExperimentComparePage from '@/pages/ExperimentCompare'
import RunDetailPage from '@/pages/RunDetail'
import ReportListPage from '@/pages/ReportList'
import ReportDetailPage from '@/pages/ReportDetail'
import RiskOverviewPage from '@/pages/RiskOverview'
import RiskRuleSetDetailPage from '@/pages/RiskRuleSetDetail'
import RiskRuleVersionDetailPage from '@/pages/RiskRuleVersionDetail'
import AuditLogPage from '@/pages/AuditLog'
import SystemHealthPage from '@/pages/SystemHealth'
import AIAssistantPage from '@/pages/AIAssistant'
import PaperTradingPage from '@/pages/PaperTrading'
import NotFoundPage from '@/pages/NotFound'

export interface Crumb {
  label: ReactNode
  /** 带 path 渲染为链接（中间层级） */
  path?: string
}

export interface RouteHandle {
  crumb?: (params: Record<string, string>) => Crumb[]
}

const crumb = (fn: RouteHandle['crumb']): RouteHandle => ({ crumb: fn })

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },

      { path: 'datasets', element: <DatasetListPage />, handle: crumb(() => [{ label: '数据目录' }]) },
      {
        path: 'datasets/:datasetId',
        element: <DatasetDetailPage />,
        handle: crumb((p) => [
          { label: '数据目录', path: '/datasets' },
          { label: p.datasetId ?? '' },
        ]),
      },
      {
        path: 'datasets/:datasetId/versions',
        element: <VersionListPage />,
        handle: crumb((p) => [
          { label: '数据目录', path: '/datasets' },
          { label: p.datasetId ?? '', path: `/datasets/${p.datasetId}` },
          { label: '版本' },
        ]),
      },
      {
        path: 'datasets/:datasetId/versions/:versionId',
        element: <VersionDetailPage />,
        handle: crumb((p) => [
          { label: '数据目录', path: '/datasets' },
          { label: p.datasetId ?? '', path: `/datasets/${p.datasetId}` },
          { label: '版本', path: `/datasets/${p.datasetId}/versions` },
          { label: p.versionId ?? '' },
        ]),
      },

      { path: 'strategies', element: <StrategyListPage />, handle: crumb(() => [{ label: '策略实验室' }]) },
      {
        path: 'strategies/:strategyId',
        element: <StrategyDetailPage />,
        handle: crumb((p) => [
          { label: '策略实验室', path: '/strategies' },
          { label: p.strategyId ?? '' },
        ]),
      },
      {
        path: 'strategies/:strategyId/versions/:versionId',
        element: <StrategyVersionDetailPage />,
        handle: crumb((p) => [
          { label: '策略实验室', path: '/strategies' },
          { label: p.strategyId ?? '', path: `/strategies/${p.strategyId}` },
          { label: p.versionId ?? '' },
        ]),
      },
      {
        path: 'models/:modelId',
        element: <ModelDetailPage />,
        handle: crumb((p) => [
          { label: '策略实验室', path: '/strategies' },
          { label: p.modelId ?? '' },
        ]),
      },
      {
        path: 'models/:modelId/versions/:versionId',
        element: <ModelVersionDetailPage />,
        handle: crumb((p) => [
          { label: '策略实验室', path: '/strategies' },
          { label: p.modelId ?? '' },
          { label: p.versionId ?? '' },
        ]),
      },

      { path: 'experiments', element: <ExperimentListPage />, handle: crumb(() => [{ label: '实验' }]) },
      { path: 'experiments/new', element: <ExperimentNewPage />, handle: crumb(() => [{ label: '实验', path: '/experiments' }, { label: '新建实验' }]) },
      {
        path: 'experiments/:expId',
        element: <ExperimentDetailPage />,
        handle: crumb((p) => [
          { label: '实验', path: '/experiments' },
          { label: p.expId ?? '' },
        ]),
      },
      {
        path: 'experiments/:expId/compare',
        element: <ExperimentComparePage />,
        handle: crumb((p) => [
          { label: '实验', path: '/experiments' },
          { label: p.expId ?? '', path: `/experiments/${p.expId}` },
          { label: '比较' },
        ]),
      },
      {
        path: 'experiments/:expId/runs/:runId',
        element: <RunDetailPage />,
        handle: crumb((p) => [
          { label: '实验', path: '/experiments' },
          { label: p.expId ?? '', path: `/experiments/${p.expId}` },
          { label: `运行 ${p.runId ?? ''}` },
        ]),
      },

      { path: 'reports', element: <ReportListPage />, handle: crumb(() => [{ label: '报告' }]) },
      {
        path: 'reports/:reportId',
        element: <ReportDetailPage />,
        handle: crumb((p) => [
          { label: '报告', path: '/reports' },
          { label: p.reportId ?? '' },
        ]),
      },

      { path: 'risk', element: <RiskOverviewPage />, handle: crumb(() => [{ label: '风险管理' }]) },
      {
        path: 'risk/rule-sets/:riskRuleSetId',
        element: <RiskRuleSetDetailPage />,
        handle: crumb((p) => [
          { label: '风险管理', path: '/risk' },
          { label: p.riskRuleSetId ?? '' },
        ]),
      },
      {
        path: 'risk/rule-sets/:riskRuleSetId/versions/:versionId',
        element: <RiskRuleVersionDetailPage />,
        handle: crumb((p) => [
          { label: '风险管理', path: '/risk' },
          { label: p.riskRuleSetId ?? '', path: `/risk/rule-sets/${p.riskRuleSetId}` },
          { label: p.versionId ?? '' },
        ]),
      },
      { path: 'audit', element: <AuditLogPage />, handle: crumb(() => [{ label: '审计日志' }]) },
      { path: 'system', element: <SystemHealthPage />, handle: crumb(() => [{ label: '系统健康' }]) },
      { path: 'ai', element: <AIAssistantPage />, handle: crumb(() => [{ label: 'AI 研究助手' }]) },
      { path: 'paper-trading', element: <PaperTradingPage />, handle: crumb(() => [{ label: '模拟盘' }]) },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
