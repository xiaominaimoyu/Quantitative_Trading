import { describe, expect, it } from 'vitest';
import {
  compareStrategies,
  renderComparisonMarkdown,
  type BacktestStrategy,
  type Bar,
  type Contender,
  type Order,
} from '../src/index.js';

const T1 = 1_700_000_000_000;
const T2 = T1 + 86_400_000;
const T3 = T1 + 2 * 86_400_000;

function bars(points: Array<[number, number]>): Bar[] {
  return points.map(([timestamp, close]) => ({
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  }));
}

/** Contender strategies scripted by [buyTimestamp, sellTimestamp] pairs. */
function scripted(id: string, buyAt: number, sellAt: number | null): BacktestStrategy {
  return {
    id,
    onBar(ctx) {
      const order = (side: 'buy' | 'sell'): Order => ({
        id: `${id}-${side}-${ctx.bar.timestamp}`,
        symbol: ctx.symbol,
        side,
        type: 'market',
        quantity: 100,
      });
      if (ctx.bar.timestamp === buyAt) {
        return [order('buy')];
      }
      if (sellAt !== null && ctx.bar.timestamp === sellAt) {
        return [order('sell')];
      }
      return [];
    },
  };
}

const DATASET = { TEST: bars([[T1, 100], [T2, 110], [T3, 105]]) };
const CONFIG = { initialCash: 20_000, cost: { commission: { rate: 0.001 } } } as const;

// A: never trades (flat 20_000, zero drawdown); B: round trip at the top;
// C: buys day one, sells day three.
const CONTENDERS: Contender[] = [
  { label: 'A', strategy: scripted('idle', -1, null), strategyParams: { mode: 'idle' } },
  { label: 'B', strategy: scripted('swing', T1, T2), strategyParams: { mode: 'swing' } },
  { label: 'C', strategy: scripted('hold', T1, T3), strategyParams: { mode: 'hold' } },
];

describe('compareStrategies', () => {
  const report = compareStrategies(CONTENDERS, DATASET, CONFIG);

  it('runs every contender on the shared dataset and period', () => {
    expect(report.period).toEqual({ start: T1, end: T3 });
    expect(report.contenders).toHaveLength(3);
    expect(report.contenders.every((c) => c.run.fills.length >= 0)).toBe(true);
    expect(report.contenders[0]?.run.fills).toHaveLength(0);
    expect(report.contenders[1]?.run.fills).toHaveLength(2);
  });

  it('echoes strategy identity and params into each section', () => {
    expect(report.contenders[0]).toMatchObject({
      label: 'A',
      strategyId: 'idle',
      strategyParams: { mode: 'idle' },
    });
  });

  it('builds the unified metric matrix in table order', () => {
    expect(report.metrics).toEqual([
      'totalReturnPct',
      'annualizedReturnPct',
      'maxDrawdownPct',
      'sharpeRatio',
      'calmarRatio',
      'winRate',
      'profitLossRatio',
    ]);
    expect(report.labels).toEqual(['A', 'B', 'C']);

    const totalReturnRow = report.values[0]!;
    const drawdownRow = report.values[2]!;
    expect(totalReturnRow[0]).toBe(0); // A flat
    expect(totalReturnRow[1]).toBeCloseTo(20_979 / 20_000 - 1, 10); // B
    expect(totalReturnRow[2]).toBeCloseTo(20_479.5 / 20_000 - 1, 10); // C
    expect(drawdownRow[0]).toBe(0);
    expect(drawdownRow[1]).toBe(0); // B sells at the local top
    expect(drawdownRow[2]).toBeGreaterThan(0); // C rides the day-three dip
  });

  it('ranks best-first by the chosen metric', () => {
    expect(report.rankBy).toBe('totalReturnPct');
    expect(report.ranking.map((r) => r.label)).toEqual(['B', 'C', 'A']);
  });

  it('ranks drawdown ascending (lower is better)', () => {
    const byDrawdown = compareStrategies(CONTENDERS, DATASET, {
      ...CONFIG,
      rankBy: 'maxDrawdownPct',
    });
    expect(byDrawdown.ranking.map((r) => r.label)).toEqual(['A', 'B', 'C']);
  });

  it('applies the shared cost configuration to every run', () => {
    for (const contender of report.contenders) {
      for (const f of contender.run.fills) {
        expect(f.commission).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic across repeated calls', () => {
    expect(compareStrategies(CONTENDERS, DATASET, CONFIG)).toEqual(report);
  });

  it('rejects fewer than two contenders and duplicate labels', () => {
    expect(() =>
      compareStrategies([CONTENDERS[0]!], DATASET, CONFIG),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    expect(() =>
      compareStrategies(
        [CONTENDERS[0]!, { ...CONTENDERS[1]!, label: 'A' }],
        DATASET,
        CONFIG,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
});

describe('renderComparisonMarkdown', () => {
  const report = compareStrategies(CONTENDERS, DATASET, CONFIG);
  const markdown = renderComparisonMarkdown(report);
  const lines = markdown.split('\n');

  it('renders a deterministic header and table skeleton', () => {
    expect(lines[0]).toBe('# Strategy Comparison');
    expect(markdown).toContain('Rank by: totalReturnPct');
    expect(markdown).toContain(`Period: ${T1} -> ${T3}`);
    expect(lines[5]).toBe('| Metric | A | B | C |');
    expect(lines[6]).toBe('|---|---:|---:|---:|');
    expect(markdown).toContain('| Total Return | 0.00% |');
  });

  it('formats percent metrics and ratios differently', () => {
    expect(markdown).toContain('| Win Rate | 0.00% |');
    expect(markdown).toContain('| Sharpe Ratio | 0.00 |');
  });

  it('lists every metric row', () => {
    for (const name of [
      'Total Return',
      'Annualized Return',
      'Max Drawdown',
      'Sharpe Ratio',
      'Calmar Ratio',
      'Win Rate',
      'Profit/Loss Ratio',
    ]) {
      expect(markdown).toContain(`| ${name} |`);
    }
  });

  it('renders the ranking best-first', () => {
    expect(markdown).toContain('Ranking (totalReturnPct):');
    expect(markdown).toContain('1. B (');
    expect(markdown).toContain('2. C (');
    expect(markdown).toContain('3. A (0.00%)');
  });
});
