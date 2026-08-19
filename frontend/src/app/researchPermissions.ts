export type B3Role = 'researcher' | 'auditor' | 'admin'
export type B3ReadScope = 'strategy:read' | 'model:read' | 'risk:read'
export type B3OwnedActionScope =
  | 'strategy:version:create'
  | 'strategy:version:freeze'
  | 'strategy:version:deprecate'
  | 'model:version:create'
  | 'model:version:freeze'
  | 'model:version:deprecate'
  | 'risk:version:create'
  | 'risk:version:freeze'
  | 'risk:version:deprecate'
export type B3CreateScope = 'strategy:create' | 'model:create' | 'risk:create'

/** B5 审计/验证/风险事件/报告 scopes，与后端 security.py 对齐。 */
export type AuditScope = 'audit:read'
export type ValidationScope = 'validation:read' | 'validation:create'
export type RiskEventScope = 'risk-event:read' | 'risk-event:create'
export type ReportScope =
  | 'report:read'
  | 'report:create'
  | 'report:submit'
  | 'report:approve'
  | 'report:deprecate'

/** B6 运维 scopes，用于 SystemHealth/Backup 等页面。 */
export type OpsScope = 'backup:read' | 'backup:create' | 'system:admin' | 'task:manage'

export type B3Scope =
  | B3ReadScope
  | B3CreateScope
  | B3OwnedActionScope
  | AuditScope
  | ValidationScope
  | RiskEventScope
  | ReportScope
  | OpsScope

const STRATEGY_SCOPES = [
  'strategy:read',
  'strategy:create',
  'strategy:version:create',
  'strategy:version:freeze',
  'strategy:version:deprecate',
] as const
const MODEL_SCOPES = [
  'model:read',
  'model:create',
  'model:version:create',
  'model:version:freeze',
  'model:version:deprecate',
] as const
const RISK_SCOPES = [
  'risk:read',
  'risk:create',
  'risk:version:create',
  'risk:version:freeze',
  'risk:version:deprecate',
] as const

/** B5 验证/风险事件/报告 scopes，按角色对齐后端 ROLE_SCOPES。 */
const VALIDATION_SCOPES_RESEARCHER = ['validation:read', 'validation:create'] as const
const RISK_EVENT_SCOPES_RESEARCHER = ['risk-event:read', 'risk-event:create'] as const
const REPORT_SCOPES_RESEARCHER = ['report:read', 'report:create', 'report:submit'] as const
const REPORT_SCOPES_AUDITOR = ['report:read', 'report:approve', 'report:deprecate'] as const
const REPORT_SCOPES_ADMIN = [
  'report:read',
  'report:create',
  'report:submit',
  'report:approve',
  'report:deprecate',
] as const
const AUDIT_SCOPE = ['audit:read'] as const

/** B6 运维 scopes。 */
const OPS_READ_SCOPE = ['backup:read'] as const
const OPS_ADMIN_SCOPES = ['backup:read', 'backup:create', 'system:admin', 'task:manage'] as const

export const B3_ROLE_SCOPES: Record<B3Role, readonly B3Scope[]> = {
  researcher: [
    ...STRATEGY_SCOPES,
    ...MODEL_SCOPES,
    'risk:read',
    ...AUDIT_SCOPE,
    ...VALIDATION_SCOPES_RESEARCHER,
    ...RISK_EVENT_SCOPES_RESEARCHER,
    ...REPORT_SCOPES_RESEARCHER,
    ...OPS_READ_SCOPE,
  ],
  auditor: [
    'strategy:read',
    'model:read',
    ...RISK_SCOPES,
    ...AUDIT_SCOPE,
    'validation:read',
    'risk-event:read',
    ...REPORT_SCOPES_AUDITOR,
    ...OPS_READ_SCOPE,
  ],
  admin: [
    ...STRATEGY_SCOPES,
    ...MODEL_SCOPES,
    ...RISK_SCOPES,
    ...AUDIT_SCOPE,
    ...VALIDATION_SCOPES_RESEARCHER,
    ...RISK_EVENT_SCOPES_RESEARCHER,
    ...REPORT_SCOPES_ADMIN,
    ...OPS_ADMIN_SCOPES,
  ],
}

interface OwnedPermissionInput {
  role: B3Role
  scopes: readonly string[]
  requiredScope: B3OwnedActionScope
  actorOwnerKey: string
  resourceOwnerKey: string
}

export function canManageOwnedResource({
  role,
  scopes,
  requiredScope,
  actorOwnerKey,
  resourceOwnerKey,
}: OwnedPermissionInput): boolean {
  if (!scopes.includes(requiredScope)) return false
  return role === 'admin' || actorOwnerKey === resourceOwnerKey
}
