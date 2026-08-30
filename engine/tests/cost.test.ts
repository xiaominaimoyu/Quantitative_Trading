import { describe, expect, it } from 'vitest';
import { ConfigError, createCostModel, StandardCostModel } from '../src/index.js';
import type { CostConfig } from '../src/index.js';

describe('commission calculation', () => {
  it('charges a fixed fee only', () => {
    const model = createCostModel({ commission: { fixedPerTrade: 10 } });
    expect(model.calcCommission(100, 100)).toBe(10);
    expect(model.calcCommission(1, 1)).toBe(10);
  });

  it('charges a proportional fee only', () => {
    const model = createCostModel({ commission: { rate: 0.001 } });
    expect(model.calcCommission(50, 200)).toBe(10);
  });

  it('applies the minimum-fee floor for small notionals', () => {
    const model = createCostModel({ commission: { rate: 0.0003, minFee: 5 } });
    expect(model.calcCommission(10, 100)).toBe(5);
  });

  it('ignores the minimum fee when the proportional fee is larger', () => {
    const model = createCostModel({ commission: { rate: 0.0003, minFee: 5 } });
    expect(model.calcCommission(100, 1000)).toBe(30);
  });

  it('uses the proportional fee exactly at the minFee boundary', () => {
    const model = createCostModel({ commission: { rate: 0.01, minFee: 5 } });
    expect(model.calcCommission(50, 10)).toBe(5);
  });

  it('stacks fixed, proportional and minimum fee', () => {
    const model = createCostModel({
      commission: { rate: 0.001, minFee: 5, fixedPerTrade: 2 },
    });
    expect(model.calcCommission(10, 100)).toBe(7);
  });

  it('rounds commission to 2 decimals', () => {
    const model = createCostModel({ commission: { rate: 0.0003 } });
    expect(model.calcCommission(123.45, 7)).toBe(0.26);
  });

  it('yields zero commission for an empty config', () => {
    expect(createCostModel().calcCommission(100, 100)).toBe(0);
    expect(createCostModel({}).calcCommission(100, 100)).toBe(0);
    expect(createCostModel({ commission: {} }).calcCommission(100, 100)).toBe(0);
  });
});

describe('slippage application', () => {
  it('is a no-op in "none" mode', () => {
    const model = createCostModel({ slippage: { mode: 'none', value: 0 } });
    expect(model.applySlippage('buy', 100)).toBe(100);
    expect(model.applySlippage('sell', 100)).toBe(100);
  });

  it('defaults to no slippage when omitted', () => {
    const model = createCostModel({});
    expect(model.applySlippage('buy', 100)).toBe(100);
  });

  it('moves buys up and sells down in "fixed" mode', () => {
    const model = createCostModel({ slippage: { mode: 'fixed', value: 0.05 } });
    expect(model.applySlippage('buy', 100)).toBe(100.05);
    expect(model.applySlippage('sell', 100)).toBe(99.95);
  });

  it('converts bps to a price offset in "bps" mode', () => {
    const model = createCostModel({ slippage: { mode: 'bps', value: 5 } });
    expect(model.applySlippage('buy', 100)).toBeCloseTo(100.05, 10);
    expect(model.applySlippage('sell', 100)).toBeCloseTo(99.95, 10);
    expect(model.applySlippage('buy', 200)).toBeCloseTo(200.1, 10);
  });

  it('never returns a negative sell price', () => {
    const model = createCostModel({ slippage: { mode: 'fixed', value: 5 } });
    expect(model.applySlippage('sell', 3)).toBe(0);
  });
});

describe('config validation', () => {
  const badConfigs: Array<{ name: string; config: CostConfig }> = [
    { name: 'negative rate', config: { commission: { rate: -0.001 } } },
    { name: 'negative minFee', config: { commission: { minFee: -1 } } },
    { name: 'negative fixedPerTrade', config: { commission: { fixedPerTrade: -1 } } },
    { name: 'NaN rate', config: { commission: { rate: Number.NaN } } },
    { name: 'infinite minFee', config: { commission: { minFee: Number.POSITIVE_INFINITY } } },
    { name: 'negative slippage value', config: { slippage: { mode: 'fixed', value: -0.01 } } },
    {
      name: 'unknown slippage mode',
      config: { slippage: { mode: 'weird' as never, value: 1 } },
    },
  ];

  for (const { name, config } of badConfigs) {
    it(`rejects ${name}`, () => {
      expect(() => createCostModel(config)).toThrow(ConfigError);
      expect(() => createCostModel(config)).toThrow(
        expect.objectContaining({ code: 'invalid_cost_config' }),
      );
    });
  }
});

describe('runtime input validation', () => {
  const model = new StandardCostModel();

  it('rejects invalid prices in applySlippage', () => {
    expect(() => model.applySlippage('buy', -1)).toThrow(ConfigError);
    expect(() => model.applySlippage('sell', Number.NaN)).toThrow(ConfigError);
  });

  it('rejects invalid inputs in calcCommission', () => {
    expect(() => model.calcCommission(-1, 10)).toThrow(ConfigError);
    expect(() => model.calcCommission(Number.NaN, 10)).toThrow(ConfigError);
    expect(() => model.calcCommission(100, -1)).toThrow(ConfigError);
    expect(() => model.calcCommission(100, Number.NaN)).toThrow(ConfigError);
  });
});
