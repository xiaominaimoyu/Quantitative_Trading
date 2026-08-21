"""Pydantic schemas for G3/G4 acceptance models"""

from datetime import datetime
from enum import Enum
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


class AcceptancePhase(str, Enum):
    """验收阶段枚举"""
    B0_B1 = "B0_B1"
    B2 = "B2"
    B3 = "B3"
    B4 = "B4"
    B5 = "B5"
    B6 = "B6"


class AcceptanceStatus(str, Enum):
    """验收状态枚举"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"


class ChecklistResult(str, Enum):
    """检查结果枚举"""
    PASS = "pass"
    FAIL = "fail"
    PENDING = "pending"


class IssueSeverity(str, Enum):
    """问题严重程度枚举"""
    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    TRIVIAL = "trivial"


class IssueStatus(str, Enum):
    """问题状态枚举"""
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


class SignatureRole(str, Enum):
    """签字角色枚举"""
    BUSINESS_OWNER = "business_owner"
    DOMAIN_EXPERT = "domain_expert"
    QA_LEAD = "qa_lead"
    SECURITY_AUDITOR = "security_auditor"
    OPS_REP = "ops_rep"


class TestType(str, Enum):
    """测试类型枚举"""
    PERFORMANCE = "performance"
    RELIABILITY = "reliability"
    SECURITY = "security"
    API_CONTRACT = "api_contract"
    INTEGRATION = "integration"


class TestResultStatus(str, Enum):
    """测试结果状态枚举"""
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"
    SKIPPED = "skipped"


# Acceptance Report Schemas
class AcceptanceReportBase(BaseModel):
    phase: AcceptancePhase
    title: str = Field(..., max_length=255)
    description: Optional[str] = None
    status: AcceptanceStatus = AcceptanceStatus.PENDING
    assignee_id: Optional[UUID] = None
    due_date: Optional[datetime] = None


class AcceptanceReportCreate(AcceptanceReportBase):
    pass


class AcceptanceReportUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    assignee_id: Optional[UUID] = None
    due_date: Optional[datetime] = None


class AcceptanceReportResponse(AcceptanceReportBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    created_by: UUID

    class Config:
        from_attributes = True


# Checklist Item Schemas
class ChecklistItemBase(BaseModel):
    item_id: str = Field(..., max_length=50)
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    result: ChecklistResult = ChecklistResult.PENDING
    notes: Optional[str] = None


class ChecklistItemCreate(ChecklistItemBase):
    report_id: UUID


class ChecklistItemResponse(ChecklistItemBase):
    id: UUID
    report_id: UUID
    checked_at: Optional[datetime] = None
    checked_by: Optional[UUID] = None

    class Config:
        from_attributes = True


# Issue Schemas
class IssueBase(BaseModel):
    title: str = Field(..., max_length=255)
    description: Optional[str] = None
    severity: IssueSeverity = IssueSeverity.MAJOR
    status: IssueStatus = IssueStatus.OPEN
    assignee_id: Optional[UUID] = None
    resolution_notes: Optional[str] = None


class IssueCreate(IssueBase):
    checklist_id: Optional[UUID] = None


class IssueResponse(IssueBase):
    id: UUID
    checklist_id: Optional[UUID] = None
    created_at: datetime
    created_by: UUID
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Signature Schemas
class SignatureBase(BaseModel):
    role: SignatureRole
    signature_data: Optional[str] = None
    notes: Optional[str] = None


class SignatureCreate(SignatureBase):
    report_id: UUID


class SignatureResponse(SignatureBase):
    id: UUID
    report_id: UUID
    signer_id: UUID
    signed_at: datetime

    class Config:
        from_attributes = True


# Test Result Schemas
class TestResultBase(BaseModel):
    test_type: TestType
    test_name: str = Field(..., max_length=255)
    status: TestResultStatus = TestResultStatus.PASSED
    metrics: Optional[dict] = None
    error_details: Optional[str] = None


class TestResultCreate(TestResultBase):
    report_id: Optional[UUID] = None


class TestResultResponse(TestResultBase):
    id: UUID
    report_id: Optional[UUID] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True