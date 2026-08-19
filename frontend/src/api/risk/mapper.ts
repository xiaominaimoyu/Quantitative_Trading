import {
  mapResearchContainer,
  mapResearchVersion,
} from '../research/mapper.ts'
import type {
  RiskRuleSet,
  RiskRuleSetWire,
  RiskRuleVersion,
  RiskRuleVersionWire,
} from './types.ts'

export function mapRiskRuleSet(value: RiskRuleSetWire): RiskRuleSet {
  return mapResearchContainer(value)
}

export function mapRiskRuleVersion(value: RiskRuleVersionWire): RiskRuleVersion {
  return {
    ...mapResearchVersion(value),
    riskRuleSetId: value.risk_rule_set_id,
  }
}
