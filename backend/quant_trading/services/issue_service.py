"""Issue tracking service"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from quant_trading.models.issue import Issue, IssueSeverity, IssueStatus


class IssueService:
    """问题跟踪服务"""

    def __init__(self, db: Session):
        self.db = db

    def create_issue(
        self,
        title: str,
        description: Optional[str] = None,
        severity: IssueSeverity = IssueSeverity.MAJOR,
        checklist_id: Optional[UUID] = None,
        created_by: UUID = None,
    ) -> Issue:
        """创建问题"""
        issue = Issue(
            title=title,
            description=description,
            severity=severity,
            checklist_id=checklist_id,
            created_by=created_by,
        )
        self.db.add(issue)
        self.db.commit()
        self.db.refresh(issue)
        return issue

    def get_issue(self, issue_id: UUID) -> Optional[Issue]:
        """获取问题详情"""
        return self.db.query(Issue).filter(
            Issue.id == issue_id
        ).first()

    def list_issues(
        self,
        severity: Optional[IssueSeverity] = None,
        status: Optional[IssueStatus] = None,
        assignee_id: Optional[UUID] = None,
        checklist_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Issue]:
        """获取问题列表"""
        query = self.db.query(Issue)

        if severity:
            query = query.filter(Issue.severity == severity)
        if status:
            query = query.filter(Issue.status == status)
        if assignee_id:
            query = query.filter(Issue.assignee_id == assignee_id)
        if checklist_id:
            query = query.filter(Issue.checklist_id == checklist_id)

        return query.order_by(Issue.created_at.desc()).offset(skip).limit(limit).all()

    def update_status(
        self,
        issue_id: UUID,
        new_status: IssueStatus,
    ) -> Optional[Issue]:
        """更新问题状态"""
        issue = self.get_issue(issue_id)
        if not issue:
            return None

        try:
            issue.update_status(new_status)
            self.db.commit()
            self.db.refresh(issue)
            return issue
        except ValueError as e:
            raise ValueError(f"Invalid status transition: {e}")

    def assign_issue(
        self,
        issue_id: UUID,
        user_id: UUID,
    ) -> Optional[Issue]:
        """分配处理人"""
        issue = self.get_issue(issue_id)
        if not issue:
            return None

        issue.assign(user_id)
        self.db.commit()
        self.db.refresh(issue)
        return issue

    def link_checklist(
        self,
        issue_id: UUID,
        checklist_id: UUID,
    ) -> Optional[Issue]:
        """关联检查项"""
        issue = self.get_issue(issue_id)
        if not issue:
            return None

        issue.checklist_id = checklist_id
        self.db.commit()
        self.db.refresh(issue)
        return issue