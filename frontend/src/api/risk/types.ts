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

export interface AshareDailyRiskRulesV1 {
  contract_version: 'ashare_daily_risk_v1'
  market: 'CN_A'
  frequency: 'daily'
  max_single_position_bp: number
  max_industry_position_bp: number
  max_gross_exposure_bp: number
  max_concentration_hhi_bp: number
  max_daily_turnover_bp: number
  daily_loss_circuit_breaker_bp: number
  max_drawdown_circuit_breaker_bp: number
  uncertain_state_action: 'freeze_risk_increase'
  risk_reduction_bypasses_opening_limits: true
  input_contract: 'risk_targets_v1'
  output_contract: 'risk_decision_v1'
}

export type RiskRuleSet = ResearchContainer

export interface RiskRuleVersion
  extends ResearchVersion<AshareDailyRiskRulesV1> {
  riskRuleSetId: string
}

export interface RiskRuleSetWire extends ResearchContainerWire {}

export interface RiskRuleVersionWire
  extends ResearchVersionWire<AshareDailyRiskRulesV1> {
  risk_rule_set_id: string
}

export interface CreateRiskRuleVersionInput {
  content: AshareDailyRiskRulesV1
  parentVersionId: string | null
  note: string | null
}

export type CreateRiskRuleSetInput = CreateResearchContainerInput
export type RiskRuleSetListQuery = ResearchListQuery
export type RiskRuleVersionListQuery = ResearchVersionListQuery
export type RiskRuleSetPage = PagedResult<RiskRuleSet>
export type RiskRuleVersionPage = PagedResult<RiskRuleVersion>
export type RiskRuleSetMutation = MutationResult<RiskRuleSet>
export type RiskRuleVersionMutation = MutationResult<RiskRuleVersion>
export type { MutationOptions }
