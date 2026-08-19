import type {
  CreateResearchContainerInput,
  MutationOptions,
  MutationResult,
  PagedResult,
  ResearchContainer,
  ResearchContainerWire,
  ResearchListQuery,
  ResearchVersion,
  ResearchVersionListQuery,
  ResearchVersionWire,
} from '../research/types.ts'

export interface CrossSectionalMomentumStrategyV1 {
  contract_version: 'cross_sectional_momentum_v1'
  strategy_kind: 'cross_sectional_momentum'
  universe: 'csi300_point_in_time'
  frequency: 'daily'
  signal_price: 'close'
  signal_adjustment: 'none' | 'forward' | 'backward'
  lookback_trading_days: number
  select_top_n: number
  rebalance_every_trading_days: number
  weighting: 'equal_weight'
  long_only: true
  decision_timing: 'after_close'
  earliest_execution: 'next_open'
  output_contract: 'target_weights_v1'
}

export type Strategy = ResearchContainer

export interface StrategyVersion
  extends ResearchVersion<CrossSectionalMomentumStrategyV1> {
  strategyId: string
}

export interface StrategyWire extends ResearchContainerWire {}

export interface StrategyVersionWire
  extends ResearchVersionWire<CrossSectionalMomentumStrategyV1> {
  strategy_id: string
}

export interface CreateStrategyVersionInput {
  content: CrossSectionalMomentumStrategyV1
  parentVersionId: string | null
  note: string | null
}

export type CreateStrategyInput = CreateResearchContainerInput
export type StrategyListQuery = ResearchListQuery
export type StrategyVersionListQuery = ResearchVersionListQuery
export type StrategyPage = PagedResult<Strategy>
export type StrategyVersionPage = PagedResult<StrategyVersion>
export type StrategyMutation = MutationResult<Strategy>
export type StrategyVersionMutation = MutationResult<StrategyVersion>
export type { MutationOptions }
