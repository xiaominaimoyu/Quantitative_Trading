import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EngineError,
  SMA_CROSSOVER_DEFAULTS,
  assertPluginShape,
  createRegistry,
  defineStrategy,
  instantiatePlugin,
  loadStrategyModule,
  runPluginBacktest,
  smaCrossoverPlugin,
  validateSmaCrossoverParams,
  type Bar,
  type StrategyPlugin,
} from '../src/index.js';

const DAY = 86_400_000;
const T1 = 1_700_000_000_000;

function bars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    timestamp: T1 + i * DAY,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  }));
}

const CONFIG = { initialCash: 20_000 } as const;

describe('instantiatePlugin', () => {
  it('merges user params over defaults and validates', () => {
    const loaded = instantiatePlugin(smaCrossoverPlugin, {
      fastPeriod: 2,
      slowPeriod: 3,
    });
    expect(loaded.pluginId).toBe('sma-crossover');
    expect(loaded.params).toEqual({
      symbol: 'TEST',
      fastPeriod: 2,
      slowPeriod: 3,
      quantity: 100,
    });
  });

  it('rejects invalid merged params with all messages', () => {
    expect(() =>
      instantiatePlugin(smaCrossoverPlugin, { fastPeriod: 5, slowPeriod: 3 }),
    ).toThrow(
      expect.objectContaining({
        code: 'invalid_input',
        message: expect.stringContaining('fastPeriod must be smaller than slowPeriod'),
      }),
    );
  });

  it('calls init once and makes teardown a one-shot', () => {
    const events: string[] = [];
    const plugin: StrategyPlugin<{ x: number }> = {
      id: 'lifecycle-spy',
      defaultParams: { x: 1 },
      create: ({ params }) => ({
        init: () => events.push(`init:${params.x}`),
        onBar: () => [],
        teardown: () => events.push('teardown'),
      }),
    };
    const loaded = instantiatePlugin(plugin, { x: 7 });
    expect(events).toEqual(['init:7']);
    loaded.teardown();
    loaded.teardown();
    expect(events).toEqual(['init:7', 'teardown']);
  });
});

describe('StrategyRegistry', () => {
  it('registers, lists, looks up and creates plugins', () => {
    const registry = createRegistry([smaCrossoverPlugin]);
    expect(registry.list().map((p) => p.id)).toEqual(['sma-crossover']);
    expect(registry.get('sma-crossover')?.id).toBe('sma-crossover');
    expect(registry.get('nope')).toBeUndefined();

    const loaded = registry.create('sma-crossover', { quantity: 50 });
    expect(loaded.params).toEqual({ ...SMA_CROSSOVER_DEFAULTS, quantity: 50 });
  });

  it('rejects duplicate ids and unknown lookups', () => {
    const registry = createRegistry([smaCrossoverPlugin]);
    expect(() => registry.register(smaCrossoverPlugin)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
    expect(() => registry.create('nope')).toThrow(
      expect.objectContaining({ code: 'invalid_input', message: expect.stringContaining('unknown strategy plugin') }),
    );
  });
});

describe('assertPluginShape', () => {
  it('accepts a minimal valid plugin', () => {
    expect(() =>
      assertPluginShape({ id: 'x', defaultParams: {}, create: () => ({ onBar: () => [] }) }),
    ).not.toThrow();
  });

  it('rejects invalid shapes', () => {
    expect(() => assertPluginShape(null)).toThrow(EngineError);
    expect(() => assertPluginShape({})).toThrow(EngineError);
    expect(() => assertPluginShape({ id: '', defaultParams: {}, create: () => ({}) })).toThrow(
      EngineError,
    );
    expect(() => assertPluginShape({ id: 'x', create: () => ({}) })).toThrow(
      expect.objectContaining({ message: expect.stringContaining('defaultParams') }),
    );
    expect(() =>
      assertPluginShape({ id: 'x', defaultParams: {}, teardown: () => undefined }),
    ).toThrow(expect.objectContaining({ message: expect.stringContaining('create') }));
  });
});

describe('loadStrategyModule', () => {
  it('loads named and default exports and rejects empty modules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qt-engine-plugin-'));
    try {
      const namedPath = join(dir, 'named.mjs');
      await writeFile(
        namedPath,
        [
          'export const strategy = {',
          "  id: 'external-named',",
          '  defaultParams: {},',
          '  create: () => ({ onBar: () => [] }),',
          '};',
        ].join('\n'),
        'utf8',
      );
      const named = await loadStrategyModule(namedPath);
      expect(named.id).toBe('external-named');

      const defaultPath = join(dir, 'default.mjs');
      await writeFile(
        defaultPath,
        [
          'export default {',
          "  id: 'external-default',",
          '  defaultParams: {},',
          '  create: () => ({ onBar: () => [] }),',
          '};',
        ].join('\n'),
        'utf8',
      );
      const fallback = await loadStrategyModule(defaultPath);
      expect(fallback.id).toBe('external-default');

      const emptyPath = join(dir, 'empty.mjs');
      await writeFile(emptyPath, 'export const unrelated = 1;\n', 'utf8');
      await expect(loadStrategyModule(emptyPath)).rejects.toThrow(
        expect.objectContaining({ code: 'invalid_input' }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runPluginBacktest — SMA crossover template', () => {
  // Golden cross at t4 (fast 12.5 > slow 11.667 after 10 <= 10),
  // death cross at t7 (fast 8.5 < slow 12.333 after 16 > 15.667).
  const dataset = { TEST: bars([10, 10, 10, 15, 20, 12, 5]) };

  it('buys on the golden cross and liquidates on the death cross', () => {
    const { result, params } = runPluginBacktest(
      smaCrossoverPlugin,
      { fastPeriod: 2, slowPeriod: 3 },
      dataset,
      CONFIG,
    );
    expect(result.fills).toHaveLength(2);
    expect(result.fills[0]).toMatchObject({ side: 'buy', quantity: 100, price: 15 });
    expect(result.fills[1]).toMatchObject({ side: 'sell', quantity: 100, price: 5 });
    expect(result.finalPortfolio.positions).toHaveLength(0);
    expect(result.finalPortfolio.cash).toBeCloseTo(19_000, 8);
    expect(params).toEqual({ symbol: 'TEST', fastPeriod: 2, slowPeriod: 3, quantity: 100 });
  });

  it('keeps instances independent across runs', () => {
    const first = runPluginBacktest(
      smaCrossoverPlugin,
      { fastPeriod: 2, slowPeriod: 3, quantity: 100 },
      dataset,
      CONFIG,
    );
    const second = runPluginBacktest(
      smaCrossoverPlugin,
      { fastPeriod: 2, slowPeriod: 3, quantity: 50 },
      dataset,
      CONFIG,
    );
    expect(first.result.fills[0]?.quantity).toBe(100);
    expect(second.result.fills[0]?.quantity).toBe(50);
  });

  it('validates params before running', () => {
    expect(() =>
      runPluginBacktest(
        smaCrossoverPlugin,
        { fastPeriod: 3, slowPeriod: 3 },
        dataset,
        CONFIG,
      ),
    ).toThrow(EngineError);
  });
});

describe('runPluginBacktest — lifecycle guarantees', () => {
  const events: string[] = [];
  const spyPlugin: StrategyPlugin<{ fail: boolean }> = {
    id: 'spy',
    defaultParams: { fail: false },
    create: ({ params }) => ({
      init: () => events.push('init'),
      onBar: (ctx) => {
        events.push(`bar:${ctx.bar.timestamp}`);
        if (params.fail) {
          throw new Error('boom');
        }
        return [];
      },
      teardown: () => events.push('teardown'),
    }),
  };

  it('runs init -> bars -> teardown in order on success', () => {
    events.length = 0;
    runPluginBacktest(spyPlugin, { fail: false }, { TEST: bars([10, 11]) }, CONFIG);
    expect(events).toEqual(['init', `bar:${T1}`, `bar:${T1 + DAY}`, 'teardown']);
  });

  it('still tears down when onBar throws', async () => {
    events.length = 0;
    await expect(
      Promise.resolve().then(() =>
        runPluginBacktest(spyPlugin, { fail: true }, { TEST: bars([10]) }, CONFIG),
      ),
    ).rejects.toThrow('boom');
    expect(events).toEqual(['init', `bar:${T1}`, 'teardown']);
  });
});

describe('SMA crossover parameter validation', () => {
  it('reports every violation', () => {
    const errors = validateSmaCrossoverParams({
      symbol: ' ',
      fastPeriod: 0,
      slowPeriod: 1.5,
      quantity: -1,
    });
    expect(errors).toHaveLength(4);
    expect(errors[3]).toContain('quantity');
  });
});

describe('defineStrategy', () => {
  it('is an identity helper', () => {
    expect(defineStrategy(smaCrossoverPlugin)).toBe(smaCrossoverPlugin);
  });
});
