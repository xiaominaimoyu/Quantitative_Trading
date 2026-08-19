import { isRealApiMode } from '../config.ts'
import * as mock from './mock.ts'
import * as real from './real.ts'
import type {
  CreateStrategyInput,
  CreateStrategyVersionInput,
  MutationOptions,
  StrategyListQuery,
  StrategyVersionListQuery,
} from './types.ts'

export type * from './types.ts'
export { RESEARCH_VERSION_STATUS_LABEL } from '../research/types.ts'

export const readsAreReal = isRealApiMode

export function listStrategies(query?: StrategyListQuery) {
  return isRealApiMode ? real.listStrategies(query) : mock.listStrategies(query)
}

export function getStrategy(id: string) {
  return isRealApiMode ? real.getStrategy(id) : mock.getStrategy(id)
}

export function listStrategyVersions(id: string, query?: StrategyVersionListQuery) {
  return isRealApiMode
    ? real.listStrategyVersions(id, query)
    : mock.listStrategyVersions(id, query)
}

export function getStrategyVersion(id: string) {
  return isRealApiMode ? real.getStrategyVersion(id) : mock.getStrategyVersion(id)
}

export function createStrategy(input: CreateStrategyInput, options: MutationOptions) {
  return isRealApiMode
    ? real.createStrategy(input, options)
    : mock.createStrategy(input, options)
}

export function createStrategyVersion(
  id: string,
  input: CreateStrategyVersionInput,
  options: MutationOptions,
) {
  return isRealApiMode
    ? real.createStrategyVersion(id, input, options)
    : mock.createStrategyVersion(id, input, options)
}

export function freezeStrategyVersion(id: string, reason: string, options: MutationOptions) {
  return isRealApiMode
    ? real.freezeStrategyVersion(id, reason, options)
    : mock.freezeStrategyVersion(id, reason, options)
}

export function deprecateStrategyVersion(id: string, reason: string, options: MutationOptions) {
  return isRealApiMode
    ? real.deprecateStrategyVersion(id, reason, options)
    : mock.deprecateStrategyVersion(id, reason, options)
}
