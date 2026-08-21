"""Checklist service"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from quant_trading.models.checklist_item import ChecklistItem, ChecklistResult
from quant_trading.models.issue import Issue, IssueSeverity, IssueStatus


class ChecklistService:
    """验收检查项服务"""

    def __init__(self, db: Session):
        self.db = db

    def list_checklists(
        self,
        report_id: Optional[UUID] = None,
        result: Optional[ChecklistResult] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ChecklistItem]:
        """获取检查项列表"""
        query = self.db.query(ChecklistItem)

        if report_id:
            query = query.filter(ChecklistItem.report_id == report_id)
        if result:
            query = query.filter(ChecklistItem.result == result)

        return query.order_by(ChecklistItem.item_id).offset(skip).limit(limit).all()

    def get_checklist(self, checklist_id: UUID) -> Optional[ChecklistItem]:
        """获取检查项详情"""
        return self.db.query(ChecklistItem).filter(
            ChecklistItem.id == checklist_id
        ).first()

    def execute_checklist(
        self,
        checklist_id: UUID,
        result: ChecklistResult,
        notes: Optional[str] = None,
        checked_by: Optional[UUID] = None,
    ) -> Optional[ChecklistItem]:
        """执行检查项"""
        checklist = self.get_checklist(checklist_id)
        if not checklist:
            return None

        checklist.execute(result=result, notes=notes, checked_by=checked_by)

        # 如果检查失败，自动创建问题记录
        if result == ChecklistResult.FAIL:
            self._auto_create_issue(checklist)

        self.db.commit()
        self.db.refresh(checklist)
        return checklist

    def batch_execute(
        self,
        checklist_ids: List[UUID],
        result: ChecklistResult,
        notes: Optional[str] = None,
        checked_by: Optional[UUID] = None,
    ) -> List[ChecklistItem]:
        """批量执行检查项"""
        checklists = self.db.query(ChecklistItem).filter(
            ChecklistItem.id.in_(checklist_ids)
        ).all()

        for checklist in checklists:
            checklist.execute(result=result, notes=notes, checked_by=checked_by)

            # 如果检查失败，自动创建问题记录
            if result == ChecklistResult.FAIL:
                self._auto_create_issue(checklist)

        self.db.commit()
        for checklist in checklists:
            self.db.refresh(checklist)

        return checklists

    def reset_checklist(self, checklist_id: UUID) -> Optional[ChecklistItem]:
        """重置检查项"""
        checklist = self.get_checklist(checklist_id)
        if not checklist:
            return None

        checklist.reset()
        self.db.commit()
        self.db.refresh(checklist)
        return checklist

    def _auto_create_issue(self, checklist: ChecklistItem) -> None:
        """自动创建问题记录"""
        # 检查是否已存在未关闭的问题
        existing_issue = self.db.query(Issue).filter(
            Issue.checklist_id == checklist.id,
            Issue.status != IssueStatus.CLOSED,
        ).first()

        if not existing_issue:
            issue = Issue(
                checklist_id=checklist.id,
                title=f"检查项失败: {checklist.name}",
                description=checklist.notes or "检查项执行失败，需要处理",
                severity=IssueSeverity.MAJOR,
                status=IssueStatus.OPEN,
                created_by=checklist.checked_by,
            )
            self.db.add(issue)