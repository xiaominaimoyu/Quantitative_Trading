"""Issue tracking data model"""

from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, declarative_base

from quant_trading.core.database import Base


class IssueSeverity(str, Enum):
    """问题严重程度枚举"""
    CRITICAL = "critical"   # 严重
    MAJOR = "major"         # 主要
    MINOR = "minor"         # 次要
    TRIVIAL = "trivial"     # 轻微


class IssueStatus(str, Enum):
    """问题状态枚举"""
    OPEN = "open"               # 待处理
    IN_PROGRESS = "in_progress" # 处理中
    RESOLVED = "resolved"       # 已解决
    CLOSED = "closed"           # 已关闭


class Issue(Base):
    """问题跟踪模型"""

    __tablename__ = "issues"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        unique=True,
        nullable=False,
    )

    # 关联的检查项ID（可为空，表示独立问题）
    checklist_id = Column(
        UUID(as_uuid=True),
        ForeignKey("checklist_items.id"),
        nullable=True,
        index=True,
    )

    # 问题标题
    title = Column(String(255), nullable=False)

    # 问题描述
    description = Column(Text, nullable=True)

    # 严重程度
    severity = Column(
        SQLEnum(IssueSeverity),
        nullable=False,
        default=IssueSeverity.MAJOR,
        index=True,
    )

    # 问题状态
    status = Column(
        SQLEnum(IssueStatus),
        nullable=False,
        default=IssueStatus.OPEN,
        index=True,
    )

    # 指派给（用户ID）
    assignee_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    # 解决时间
    resolved_at = Column(DateTime, nullable=True)

    # 解决备注
    resolution_notes = Column(Text, nullable=True)

    # 创建时间
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    # 创建人（用户ID）
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )

    # 关联关系
    checklist = relationship(
        "ChecklistItem",
        back_populates="issues",
    )

    assignee = relationship(
        "User",
        foreign_keys=[assignee_id],
        backref="assigned_issues",
    )

    creator = relationship(
        "User",
        foreign_keys=[created_by],
        backref="created_issues",
    )

    def update_status(self, new_status: IssueStatus) -> None:
        """更新问题状态"""
        valid_transitions = {
            IssueStatus.OPEN: [IssueStatus.IN_PROGRESS, IssueStatus.CLOSED],
            IssueStatus.IN_PROGRESS: [IssueStatus.RESOLVED, IssueStatus.OPEN],
            IssueStatus.RESOLVED: [IssueStatus.CLOSED, IssueStatus.OPEN],
            IssueStatus.CLOSED: [IssueStatus.OPEN],
        }

        if new_status not in valid_transitions.get(self.status, []):
            raise ValueError(
                f"Invalid status transition: {self.status.value} -> {new_status.value}"
            )

        self.status = new_status
        if new_status == IssueStatus.RESOLVED:
            self.resolved_at = datetime.utcnow()

    def assign(self, user_id: str) -> None:
        """分配处理人"""
        self.assignee_id = user_id

    def __repr__(self) -> str:
        return f"<Issue(id={self.id}, title={self.title}, status={self.status.value})>"