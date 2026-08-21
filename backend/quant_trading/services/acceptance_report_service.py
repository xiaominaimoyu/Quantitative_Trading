"""Acceptance report service"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from quant_trading.models.acceptance_report import (
    AcceptanceReport,
    AcceptancePhase,
    AcceptanceStatus,
)


class AcceptanceReportService:
    """验收报告服务"""

    def __init__(self, db: Session):
        self.db = db

    def create_report(
        self,
        phase: AcceptancePhase,
        title: str,
        description: Optional[str] = None,
        assignee_id: Optional[UUID] = None,
        due_date: Optional[datetime] = None,
        created_by: UUID = None,
    ) -> AcceptanceReport:
        """创建验收报告"""
        report = AcceptanceReport(
            phase=phase,
            title=title,
            description=description,
            assignee_id=assignee_id,
            due_date=due_date,
            created_by=created_by,
        )
        self.db.add(report)
        self.db.commit()
        self.db.refresh(report)
        return report

    def get_report(self, report_id: UUID) -> Optional[AcceptanceReport]:
        """获取报告详情"""
        return self.db.query(AcceptanceReport).filter(
            AcceptanceReport.id == report_id
        ).first()

    def list_reports(
        self,
        phase: Optional[AcceptancePhase] = None,
        status: Optional[AcceptanceStatus] = None,
        assignee_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[AcceptanceReport]:
        """获取报告列表"""
        query = self.db.query(AcceptanceReport)

        if phase:
            query = query.filter(AcceptanceReport.phase == phase)
        if status:
            query = query.filter(AcceptanceReport.status == status)
        if assignee_id:
            query = query.filter(AcceptanceReport.assignee_id == assignee_id)

        return query.order_by(AcceptanceReport.created_at.desc()).offset(skip).limit(limit).all()

    def update_report(
        self,
        report_id: UUID,
        **kwargs,
    ) -> Optional[AcceptanceReport]:
        """更新报告"""
        report = self.get_report(report_id)
        if not report:
            return None

        for key, value in kwargs.items():
            if hasattr(report, key) and value is not None:
                setattr(report, key, value)

        report.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(report)
        return report

    def update_status(
        self,
        report_id: UUID,
        new_status: AcceptanceStatus,
    ) -> Optional[AcceptanceReport]:
        """更新报告状态"""
        report = self.get_report(report_id)
        if not report:
            return None

        try:
            report.update_status(new_status)
            self.db.commit()
            self.db.refresh(report)
            return report
        except ValueError as e:
            raise ValueError(f"Invalid status transition: {e}")

    def delete_report(self, report_id: UUID) -> bool:
        """删除报告"""
        report = self.get_report(report_id)
        if not report:
            return False

        self.db.delete(report)
        self.db.commit()
        return True

    def export_report(self, report_id: UUID) -> Optional[dict]:
        """导出报告"""
        report = self.get_report(report_id)
        if not report:
            return None

        return report.get_summary()