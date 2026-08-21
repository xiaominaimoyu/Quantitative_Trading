"""Checklist item data model"""

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, declarative_base

from quant_trading.core.database import Base


class ChecklistResult(str, Enum):
    """检查结果枚举"""
    PASS = "pass"
    FAIL = "fail"
    PENDING = "pending"


class ChecklistItem(Base):
    """验收检查项模型"""

    __tablename__ = "checklist_items"

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

    # 检查项ID（格式：B0-001, B2-001等）
    item_id = Column(String(50), nullable=False)

    # 检查项名称
    name = Column(String(255), nullable=False)

    # 检查项描述
    description = Column(Text, nullable=True)

    # 验收标准
    acceptance_criteria = Column(Text, nullable=True)

    # 检查结果
    result = Column(
        SQLEnum(ChecklistResult),
        nullable=False,
        default=ChecklistResult.PENDING,
        index=True,
    )

    # 检查备注
    notes = Column(Text, nullable=True)

    # 检查时间
    checked_at = Column(DateTime, nullable=True)

    # 检查人（用户ID）
    checked_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    # 关联关系
    report = relationship(
        "AcceptanceReport",
        back_populates="checklist_items",
    )

    checker = relationship(
        "User",
        foreign_keys=[checked_by],
        backref="checked_checklists",
    )

    issues = relationship(
        "Issue",
        back_populates="checklist",
        cascade="all, delete-orphan",
    )

    def execute(
        self,
        result: ChecklistResult,
        notes: Optional[str] = None,
        checked_by: Optional[str] = None,
    ) -> None:
        """执行检查项"""
        self.result = result
        self.notes = notes
        self.checked_at = datetime.utcnow()
        self.checked_by = checked_by

    def reset(self) -> None:
        """重置检查结果"""
        self.result = ChecklistResult.PENDING
        self.notes = None
        self.checked_at = None
        self.checked_by = None

    def __repr__(self) -> str:
        return f"<ChecklistItem(id={self.id}, item_id={self.item_id}, result={self.result.value})>"