/**
 * Default {@link CostModel} implementation (P0-1).
 *
 * Deterministic and stateless. All parameters come from {@link CostConfig};
 * nothing is hard-coded in the computation path.
 */

import { ConfigError } from '../core/errors.js';
import { roundTo } from '../core/money.js';
import type { Side } from '../core/types.js';
import type { CommissionConfig, CostConfig, CostModel, SlippageConfig } from './types.js';

/** Basis-point divisor used by the `bps` slippage mode. */
const BPS_DIVISOR = 10_000;

/**
 * Validate one side of the commission config.
 *
 * @param name - Config key being validated (for error messages).
 * @param value - Value to validate.
 * @param config - Full config, used to produce actionable error messages.
 * @throws {@link ConfigError} if the value is not a non-negative finite number.
 */
function assertNonNegativeNumber(name: string, value: number, config: CostConfig): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`cost config ${JSON.stringify(config)} has invalid ${name}: ${value}`);
  }
}

/**
 * Standard cost model combining commission (fixed / proportional /
 * minimum-fee) and slippage (fixed / bps / none).
 */
export class StandardCostModel implements CostModel {
  private readonly commission: Required<CommissionConfig>;
  private readonly slippage: SlippageConfig;

  /**
   * @param config - Cost configuration; an empty object yields a zero-cost
   * model, which keeps no-fee experiments expressible.
   * @throws {@link ConfigError} if any numeric parameter is negative or
   * non-finite, or the slippage mode is unknown.
   */
  constructor(config: CostConfig = {}) {
    const c = config.commission ?? {};
    this.commission = {
      rate: c.rate ?? 0,
      minFee: c.minFee ?? 0,
      fixedPerTrade: c.fixedPerTrade ?? 0,
    };
    assertNonNegativeNumber('commission.rate', this.commission.rate, config);
    assertNonNegativeNumber('commission.minFee', this.commission.minFee, config);
    assertNonNegativeNumber('commission.fixedPerTrade', this.commission.fixedPerTrade, config);

    this.slippage = config.slippage ?? { mode: 'none', value: 0 };
    assertNonNegativeNumber('slippage.value', this.slippage.value, config);
    if (
      this.slippage.mode !== 'none' &&
      this.slippage.mode !== 'fixed' &&
      this.slippage.mode !== 'bps'
    ) {
      throw new ConfigError(
        `cost config ${JSON.stringify(config)} has unknown slippage mode: ${String(
          (this.slippage as { mode?: unknown }).mode,
        )}`,
      );
    }
  }

  /** @inheritdoc */
  public applySlippage(side: Side, price: number): number {
    if (!Number.isFinite(price) || price < 0) {
      throw new ConfigError(`applySlippage received invalid price: ${price}`);
    }
    const offset = this.slippageOffset(price);
    if (offset === 0) {
      return price;
    }
    return side === 'buy' ? price + offset : Math.max(price - offset, 0);
  }

  /** @inheritdoc */
  public calcCommission(fillPrice: number, quantity: number): number {
    if (!Number.isFinite(fillPrice) || fillPrice < 0) {
      throw new ConfigError(`calcCommission received invalid fillPrice: ${fillPrice}`);
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new ConfigError(`calcCommission received invalid quantity: ${quantity}`);
    }
    const notional = fillPrice * quantity;
    const proportional = Math.max(notional * this.commission.rate, this.commission.minFee);
    return roundTo(this.commission.fixedPerTrade + proportional, 2);
  }

  /**
   * Absolute price offset implied by the slippage config at a given price.
   *
   * @param price - Raw market price.
   * @returns Non-negative price offset.
   */
  private slippageOffset(price: number): number {
    switch (this.slippage.mode) {
      case 'none':
        return 0;
      case 'fixed':
        return this.slippage.value;
      case 'bps':
        return (price * this.slippage.value) / BPS_DIVISOR;
    }
  }
}

/**
 * Factory returning the default {@link CostModel} for a configuration.
 *
 * @param config - Cost configuration (see {@link CostConfig}).
 * @returns A deterministic, stateless cost model instance.
 */
export function createCostModel(config: CostConfig = {}): CostModel {
  return new StandardCostModel(config);
}
