/**
 * Deterministic numeric helpers.
 *
 * Float arithmetic is fine for analytics but unacceptable at fill
 * boundaries: two runs of the same experiment must produce bit-identical
 * ledgers. All money-level rounding in the engine goes through these
 * helpers so the rounding policy lives in exactly one place.
 */

/**
 * Round a value to a fixed number of decimal places (half away from zero,
 * with an epsilon guard against binary float drift such as `0.1 + 0.2`).
 *
 * Non-finite inputs are returned unchanged.
 *
 * @param value - Value to round.
 * @param decimals - Number of decimal places (default 2). Clamped to [0, 8].
 * @returns The rounded value.
 */
export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const d = Math.min(Math.max(Math.trunc(decimals), 0), 8);
  const factor = 10 ** d;
  const scaled = value * factor + Number.EPSILON * Math.sign(value);
  return Math.round(scaled) / factor;
}

/**
 * Floor a quantity down to the nearest multiple of `lotSize`.
 *
 * Used by the execution layer to enforce exchange lot constraints
 * (e.g. 100 shares per lot on A-share markets). A `lotSize` of 1 keeps
 * any valid quantity untouched.
 *
 * @param quantity - Requested quantity; must be a finite number >= 0.
 * @param lotSize - Lot size; must be a finite integer >= 1.
 * @returns The largest multiple of `lotSize` that is <= `quantity`.
 * @throws {@link RangeError} if `lotSize` is not a positive integer.
 */
export function floorToLot(quantity: number, lotSize: number): number {
  if (!Number.isInteger(lotSize) || lotSize < 1) {
    throw new RangeError(`lotSize must be a positive integer, got ${lotSize}`);
  }
  return Math.floor(quantity / lotSize) * lotSize;
}
