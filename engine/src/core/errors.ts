/**
 * Typed error hierarchy for the engine.
 *
 * Engine modules throw these instead of bare `Error`s so callers (the
 * backtest loop, the paper trading layer, tests) can branch on `code`
 * without string matching.
 */

/** Machine-readable error codes used across the engine. */
export type EngineErrorCode =
  | 'invalid_cost_config'
  | 'invalid_risk_config'
  | 'invalid_data_config'
  | 'invalid_input'
  | 'invalid_order'
  | 'insufficient_cash'
  | 'insufficient_position'
  | 'invalid_portfolio_state';

/** Base class for all engine errors. */
export class EngineError extends Error {
  /** Machine-readable code identifying the failure class. */
  public readonly code: EngineErrorCode;

  /**
   * @param code - Machine-readable failure code.
   * @param message - Human-readable description.
   */
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

/** Thrown when a cost/risk configuration is structurally or numerically invalid. */
export class ConfigError extends EngineError {
  /**
   * @param message - Description of the invalid configuration.
   * @param code - Specific config error code; defaults to the cost-model
   * code for backward compatibility. Risk limits pass `invalid_risk_config`.
   */
  constructor(message: string, code: EngineErrorCode = 'invalid_cost_config') {
    super(code, message);
    this.name = 'ConfigError';
  }
}
