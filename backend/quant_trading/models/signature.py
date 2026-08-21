"""Signature and TestResult data models"""

from datetime import datetime
from enum import Enum
from typing import Optional, Dict, Any
from uuid import uuid4

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, declarative_base

from quant_trading.core.database import Base


class SignatureRole(str, Enum):
    """签字角色枚举"""
    BUSINESS_OWNER = "business_owner"       # 业务验收负责人
    DOMAIN_EXPERT = "domain_expert"         # 领域专家
    QA_LEAD = "qa_lead"                     # 测试负责人
    SECURITY_AUDITOR = "security_auditor"   # 安全审计员
    OPS_REP = "ops_rep"                     # 运维代表


class Signature(Base):
    """签字记录模型"""

    __tablename__ = "signatures"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        unique=True,
        nullable=False,
    )

    # 关联的验收报告ID
    report_id = Column(
        UUID(as_uuid=True),
        ForeignKey("acceptance_reports.id"),
        nullable=False,
        index=True,
    )

    # 签字角色
    role = Column(
        SQLEnum(SignatureRole),
        nullable=False,
    )

    # 签字人（用户ID）
    signer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )

    # 签字数据（电子签名）
    signature_data = Column(Text, nullable=True)

    # 签字时间
    signed_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    # 备注
    notes = Column(Text, nullable=True)

    # 关联关系
    report = relationship(
        "AcceptanceReport",
        back_populates="signatures",
    )

    signer = relationship(
        "User",
        foreign_keys=[signer_id],
        backref="signatures",
    )

    def verify(self) -> bool:
        """验证签字有效性"""
        return self.signature_data is not None and self.signed_at is not None

    def __repr__(self) -> str:
        return f"<Signature(id={self.id}, role={self.role.value}, signer_id={self.signer_id})>"


class TestType(str, Enum):
    """测试类型枚举"""
    PERFORMANCE = "performance"     # 性能测试
    RELIABILITY = "reliability"     # 可靠性测试
    SECURITY = "security"           # 安全性测试
    API_CONTRACT = "api_contract"   # API契约测试
    INTEGRATION = "integration"     # 集成测试


class TestResultStatus(str, Enum):
    """测试结果状态枚举"""
    PASSED = "passed"
    FAILED = "failed"
    ERROR = "error"
    SKIPPED = "skipped"


class TestResult(Base):
    """测试结果模型"""

    __tablename__ = "test_results"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        unique=True,
        nullable=False,
    )

    # 测试类型
    test_type = Column(
        SQLEnum(TestType),
        nullable=False,
        index=True,
    )

    # 测试名称
    test_name = Column(String(255), nullable=False)

    # 测试状态
    status = Column(
        SQLEnum(TestResultStatus),
        nullable=False,
        index=True,
    )

    # 测试指标（JSON格式）
    metrics = Column(JSON, nullable=True)

    # 开始时间
    started_at = Column(DateTime, nullable=True)

    # 完成时间
    completed_at = Column(DateTime, nullable=True)

    # 关联的验收报告ID（可为空）
    report_id = Column(
        UUID(as_uuid=True),
        ForeignKey("acceptance_reports.id"),
        nullable=True,
        index=True,
    )

    # 错误详情
    error_details = Column(Text, nullable=True)

    # 关联关系
    report = relationship(
        "AcceptanceReport",
        backref="test_results",
    )

    def generate_report(self) -> Dict[str, Any]:
        """生成测试报告"""
        duration = None
        if self.started_at and self.completed_at:
            duration = (self.completed_at - self.started_at).total_seconds()

        return {
            "id": str(self.id),
            "test_type": self.test_type.value,
            "test_name": self.test_name,
            "status": self.status.value,
            "metrics": self.metrics or {},
            "duration_seconds": duration,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error_details": self.error_details,
        }

    def __repr__(self) -> str:
        return f"<TestResult(id={self.id}, test_type={self.test_type.value}, status={self.status.value})>"