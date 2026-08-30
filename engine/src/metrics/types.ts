/**
 * Performance metrics contracts (P1-5).
 *
 * The metrics module turns a {@link !BacktestResult} into a report the
 * dashboard renders directly: headline ratios, per-trade statistics and
 * the equity/drawdown series for plotting. All formulas are documented at
 * the computation site.
 */

import type { EquityPoint } from '../engine/backtest-engine.js';

/** Configuration for performance computation. */
export interface PerformanceConfig {
  /**
   * Number of return periods per year used for annualization (Sharpe and
   * Calmar). Default 252 (trading days). Use 365 for calendar-day bars.
   */
  periodsPerYear?: number;
  /** Risk-free rate per period subtracted from mean returns (Sharpe). Default 0. */
  riskFreeRatePerPeriod?: number;
  /**
   * Starting capital for the total-return calculation. Defaults to the
   * first equity point; pass `initialCash` explicitly to measure from the
   * true start.
   */
  initialCapital?: number;
}

/** One point of the drawdown curve (fraction of the running peak). */
export interface DrawdownPoint {
  readonly timestamp: number;
  /** Non-negative drawdown fraction, `1 - equity / peak` (0 at new peaks). */
  readonly drawdownPct: number;
}

/** A round-trip trade reconstructed from fills via FIFO matching. */
export interface ClosedTrade {
  readonly symbol: string;
  /** Earliest matched entry lot timestamp. */
  readonly openTimestamp: number;
  /** Exit fill timestamp. */
  readonly closeTimestamp: number;
  readonly quantity: number;
  /** Volume-weighted average entry price (excluding fees). */
  readonly entryAvgPrice: number;
  /** Exit price (post-slippage, excluding fees). */
  readonly exitAvgPrice: number;
  /** `exit * qty - entry * qty` before fees. */
  readonly grossPnl: number;
  /** Entry + exit commissions allocated to the matched quantities. */
  readonly fees: number;
  /** `grossPnl - fees`. */
  readonly netPnl: number;
}

/** Headline performance report for one backtest run. */
export interface PerformanceReport {
  /** `finalEquity / initialCapital - 1`. */
  readonly totalReturnPct: number;
  /**
   * Geometric annualization of the total return over the observed periods:
   * `(1 + totalReturn)^(periodsPerYear / periods) - 1`.
   */
  readonly annualizedReturnPct: number;
  /** Largest peak-to-trough decline of the equity curve (fraction). */
  readonly maxDrawdownPct: number;
  /**
   * `mean(r) / std(r) * sqrt(periodsPerYear)` with `r` the per-period
   * equity returns (population standard deviation). 0 when undefined.
   */
  readonly sharpeRatio: number;
  /** `annualizedReturn / maxDrawdown`; 0 when undefined. */
  readonly calmarRatio: number;
  /** Winning closed trades / (winning + losing). 0 when no closed trades. */
  readonly winRate: number;
  /** `avgWin / avgLoss` (magnitudes). Infinity when wins exist without losses. */
  readonly profitLossRatio: number;
  readonly trades: {
    /** Total closed round-trip trades. */
    readonly total: number;
    readonly wins: number;
    readonly losses: number;
  };
  /** Average net profit per winning trade (>= 0). */
  readonly avgWin: number;
  /** Average net loss magnitude per losing trade (>= 0). */
  readonly avgLoss: number;
  /** Equity curve, pass-through for plotting. */
  readonly equityCurve: readonly EquityPoint[];
  /** Drawdown series for plotting. */
  readonly drawdownCurve: readonly DrawdownPoint[];
}
