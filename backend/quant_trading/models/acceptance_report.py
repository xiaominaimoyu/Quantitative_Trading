"""Acceptance report data model"""

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, declarative_base

from quant_trading.core.database import Base


class AcceptancePhase(str, Enum):
    """验收阶段枚举"""
    B0_B1 = "B0_B1"  # API基础框架
    B2 = "B2"        # 数据快照
    B3 = "B3"        # 策略/模型/风险
    B4 = "B4"        # 实验/回测
    B5 = "B5"        # 验证/报告/审计
    B6 = "B6"        # 生产切换


class AcceptanceStatus(str, Enum):
    """验收状态枚举"""
    PENDING = "pending"           # 待验收
    IN_PROGRESS = "in_progress"   # 验收中
    PASSED = "passed"             # 验收通过
    FAILED = "failed"             # 验收不通过


class AcceptanceReport(Base):
    """验收报告模型"""

    __tablename__ = "acceptance_reports"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        unique=True,
        nullable=False,
    )

    # 验收阶段
    phase = Column(
        SQLEnum(AcceptancePhase),
        nullable=False,
        index=True,
    )

    # 报告标题
    title = Column(String(255), nullable=False)

    # 报告描述
    description = Column(Text, nullable=True)

    # 验收状态
    status = Column(
        SQLEnum(AcceptanceStatus),
        nullable=False,
        default=AcceptanceStatus.PENDING,
        index=True,
    )

    # 指派给（用户ID）
    assignee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    # 截止日期
    due_date = Column(DateTime, nullable=True)

    # 创建时间
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    # 更新时间
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # 创建人（用户ID）
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )

    # 关联关系
    checklist_items = relationship(
        "ChecklistItem",
        back_populates="report",
        cascade="all, delete-orphan",
    )

    signatures = relationship(
        "Signature",
        back_populates="report",
        cascade="all, delete-orphan",
    )

    assignee = relationship(
        "User",
        foreign_keys=[assignee_id],
        backref="assigned_reports",
    )

    creator = relationship(
        "User",
        foreign_keys=[created_by],
        backref="created_reports",
    )

    def update_status(self, new_status: AcceptanceStatus) -> None:
        """更新验收状态"""
        valid_transitions = {
            AcceptanceStatus.PENDING: [AcceptanceStatus.IN_PROGRESS],
            AcceptanceStatus.IN_PROGRESS: [AcceptanceStatus.PASSED, AcceptanceStatus.FAILED],
            AcceptanceStatus.PASSED: [],
            AcceptanceStatus.FAILED: [AcceptanceStatus.PENDING],
        }

        if new_status not in valid_transitions.get(self.status, []):
            raise ValueError(
                f"Invalid status transition: {self.status.value} -> {new_status.value}"
            )

        self.status = new_status
        self.updated_at = datetime.utcnow()

    def get_summary(self) -> dict:
        """获取报告摘要"""
        total_items = len(self.checklist_items)
        passed_items = sum(
            1 for item in self.checklist_items
            if item.result == "pass"
        )
        failed_items = sum(
            1 for item in self.checklist_items
            if item.result == "fail"
        )
        pending_items = total_items - passed_items - failed_items

        return {
            "id": str(self.id),
            "phase": self.phase.value,
            "title": self.title,
            "status": self.status.value,
            "total_items": total_items,
            "passed_items": passed_items,
            "failed_items": failed_items,
            "pending_items": pending_items,
            "completion_rate": (passed_items / total_items * 100) if total_items > 0 else 0,
        }

    def __repr__(self) -> str:
        return f"<AcceptanceReport(id={self.id}, phase={self.phase.value}, status={self.status.value})>"