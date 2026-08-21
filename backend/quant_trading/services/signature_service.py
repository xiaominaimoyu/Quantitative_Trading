"""Signature service"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from quant_trading.models.signature import Signature, SignatureRole
from quant_trading.models.acceptance_report import AcceptanceReport, AcceptanceStatus


class SignatureService:
    """验收签字服务"""

    def __init__(self, db: Session):
        self.db = db

    def create_signature(
        self,
        report_id: UUID,
        role: SignatureRole,
        signer_id: UUID,
        signature_data: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Optional[Signature]:
        """创建签字记录"""
        # 验证报告状态必须为passed
        report = self.db.query(AcceptanceReport).filter(
            AcceptanceReport.id == report_id
        ).first()

        if not report:
            return None

        if report.status != AcceptanceStatus.PASSED:
            raise ValueError("Report must be in PASSED status to sign")

        # 检查是否已经签过字
        existing_signature = self.db.query(Signature).filter(
            Signature.report_id == report_id,
            Signature.role == role,
        ).first()

        if existing_signature:
            raise ValueError(f"Role {role.value} has already signed this report")

        signature = Signature(
            report_id=report_id,
            role=role,
            signer_id=signer_id,
            signature_data=signature_data,
            notes=notes,
        )

        self.db.add(signature)
        self.db.commit()
        self.db.refresh(signature)
        return signature

    def get_signature(self, signature_id: UUID) -> Optional[Signature]:
        """获取签字详情"""
        return self.db.query(Signature).filter(
            Signature.id == signature_id
        ).first()

    def list_signatures(
        self,
        report_id: Optional[UUID] = None,
        role: Optional[SignatureRole] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Signature]:
        """获取签字列表"""
        query = self.db.query(Signature)

        if report_id:
            query = query.filter(Signature.report_id == report_id)
        if role:
            query = query.filter(Signature.role == role)

        return query.order_by(Signature.signed_at.desc()).offset(skip).limit(limit).all()

    def verify_signature(self, signature_id: UUID) -> bool:
        """验证签字有效性"""
        signature = self.get_signature(signature_id)
        if not signature:
            return False

        return signature.verify()