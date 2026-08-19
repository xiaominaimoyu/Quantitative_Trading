import {
  mapResearchContainer,
  mapResearchVersion,
} from '../research/mapper.ts'
import type {
  Strategy,
  StrategyVersion,
  StrategyVersionWire,
  StrategyWire,
} from './types.ts'

export function mapStrategy(value: StrategyWire): Strategy {
  return mapResearchContainer(value)
}

export function mapStrategyVersion(value: StrategyVersionWire): StrategyVersion {
  return {
    ...mapResearchVersion(value),
    strategyId: value.strategy_id,
  }
}
