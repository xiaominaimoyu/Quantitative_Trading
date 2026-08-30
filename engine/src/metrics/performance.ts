/**
 * Performance computation (P1-5).
 *
 * Pure functions over a backtest result; no engine state is consulted.
 * Conventions:
 * - returns are per-period equity fractions;
 * - drawdowns are non-negative fractions of the running peak;
 * - the Sharpe ratio uses the population standard deviation and returns 0
 *   when it is mathematically undefined (fewer than 2 returns, zero
 *   dispersion);
 * - the Calmar ratio divides the geometric annualized return by the max
 *   drawdown and returns 0 when the drawdown is zero.
 */

import type { BacktestResult, EquityPoint } from '../engine/backtest-engine.js';
import { pairFillsIntoTrades } from './trades.js';
import type {
  ClosedTrade,
  DrawdownPoint,
  PerformanceConfig,
  PerformanceReport,
} from './types.js';

/** Default annualization basis: 252 trading periods per year. */
const DEFAULT_PERIODS_PER_YEAR = 252;

/**
 * Compute the running-peak drawdown series of an equity curve.
 *
 * @param equityCurve - Points in chronological order.
 * @returns One drawdown point per input point (empty for empty input).
 */
export function computeDrawdownSeries(equityCurve: readonly EquityPoint[]): DrawdownPoint[] {
  let peak = Number.NEGATIVE_INFINITY;
  return equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdownPct = peak > 0 ? 1 - point.equity / peak : 0;
    return { timestamp: point.timestamp, drawdownPct: Math.max(drawdownPct, 0) };
  });
}

/**
 * Compute the full performance report for a backtest result.
 *
 * @param result - Backtest result (equity curve, fills, final portfolio).
 * @param config - Annualization and capital options.
 * @returns The dashboard-ready report; curve data included for plotting.
 */
export function computePerformance(
  result: BacktestResult,
  config: PerformanceConfig = {},
): PerformanceReport {
  const periodsPerYear = config.periodsPerYear ?? DEFAULT_PERIODS_PER_YEAR;
  const riskFreeRate = config.riskFreeRatePerPeriod ?? 0;
  const equityCurve = result.equityCurve;

  const initialCapital =
    config.initialCapital ?? (equityCurve.length > 0 ? equityCurve[0]!.equity : 0);
  const finalEquity =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1]!.equity
      : result.finalPortfolio.cash;
  const totalReturnPct = initialCapital > 0 ? finalEquity / initialCapital - 1 : 0;

  const drawdownCurve = computeDrawdownSeries(equityCurve);
  const maxDrawdownPct = drawdownCurve.reduce((max, d) => Math.max(max, d.drawdownPct), 0);

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const previous = equityCurve[i - 1]!.equity;
    if (previous > 0) {
      returns.push(equityCurve[i]!.equity / previous - 1);
    }
  }
  const annualizedReturnPct =
    totalReturnPct > -1 && returns.length > 0
      ? Math.pow(1 + totalReturnPct, periodsPerYear / returns.length) - 1
      : 0;

  let sharpeRatio = 0;
  if (returns.length >= 2) {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      sharpeRatio = ((mean - riskFreeRate) / std) * Math.sqrt(periodsPerYear);
    }
  }

  const calmarRatio = maxDrawdownPct > 0 ? annualizedReturnPct / maxDrawdownPct : 0;

  const trades: ClosedTrade[] = pairFillsIntoTrades(result.fills);
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl < 0);
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.netPnl, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0
      ? Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0) / losses.length)
      : 0;
  const winRate = wins.length + losses.length > 0 ? wins.length / (wins.length + losses.length) : 0;
  const profitLossRatio =
    wins.length === 0 ? 0 : avgLoss === 0 ? Number.POSITIVE_INFINITY : avgWin / avgLoss;

  return {
    totalReturnPct,
    annualizedReturnPct,
    maxDrawdownPct,
    sharpeRatio,
    calmarRatio,
    winRate,
    profitLossRatio,
    trades: { total: trades.length, wins: wins.length, losses: losses.length },
    avgWin,
    avgLoss,
    equityCurve,
    drawdownCurve,
  };
}
