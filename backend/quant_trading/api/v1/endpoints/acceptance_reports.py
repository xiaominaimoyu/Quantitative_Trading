"""Acceptance report API endpoints"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from quant_trading.core.database import get_db
from quant_trading.schemas.acceptance import (
    AcceptanceReportResponse,
    AcceptanceReportCreate,
    AcceptanceReportUpdate,
    AcceptancePhase,
    AcceptanceStatus,
)
from quant_trading.services.acceptance_report_service import AcceptanceReportService
from quant_trading.services.acceptance_actor import get_acceptance_actor_id

router = APIRouter(prefix="/reports", tags=["acceptance-reports"])


@router.post(
    "/",
    response_model=AcceptanceReportResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建验收报告",
)
def create_report(
    request: AcceptanceReportCreate,
    db: Session = Depends(get_db),
):
    """创建验收报告"""
    service = AcceptanceReportService(db)
    report = service.create_report(
        phase=request.phase,
        title=request.title,
        description=request.description,
        assignee_id=request.assignee_id,
        created_by=get_acceptance_actor_id(db),
    )
    return report


@router.get(
    "/",
    response_model=List[AcceptanceReportResponse],
    summary="获取验收报告列表",
)
def list_reports(
    phase: Optional[AcceptancePhase] = Query(None),
    status: Optional[AcceptanceStatus] = Query(None),
    assignee_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=0, le=1000),
    db: Session = Depends(get_db),
):
    """获取验收报告列表"""
    service = AcceptanceReportService(db)
    reports = service.list_reports(
        phase=phase,
        status=status,
        assignee_id=assignee_id,
        skip=skip,
        limit=limit,
    )
    return reports


@router.get(
    "/{report_id}",
    response_model=AcceptanceReportResponse,
    summary="获取验收报告详情",
)
def get_report(
    report_id: UUID,
    db: Session = Depends(get_db),
):
    """获取验收报告详情"""
    service = AcceptanceReportService(db)
    report = service.get_report(report_id)
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Acceptance report not found",
        )
    return report


@router.put(
    "/{report_id}",
    response_model=AcceptanceReportResponse,
    summary="更新验收报告",
)
def update_report(
    report_id: UUID,
    request: AcceptanceReportUpdate,
    db: Session = Depends(get_db),
):
    """更新验收报告"""
    service = AcceptanceReportService(db)
    report = service.update_report(
        report_id=report_id,
        title=request.title,
        description=request.description,
        assignee_id=request.assignee_id,
    )
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Acceptance report not found",
        )
    return report


@router.patch(
    "/{report_id}/status",
    response_model=AcceptanceReportResponse,
    summary="更新验收报告状态",
)
def update_report_status(
    report_id: UUID,
    new_status: AcceptanceStatus,
    db: Session = Depends(get_db),
):
    """更新验收报告状态"""
    service = AcceptanceReportService(db)
    try:
        report = service.update_status(report_id, new_status)
        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Acceptance report not found",
            )
        return report
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.delete(
    "/{report_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除验收报告",
)
def delete_report(
    report_id: UUID,
    db: Session = Depends(get_db),
):
    """删除验收报告"""
    service = AcceptanceReportService(db)
    success = service.delete_report(report_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Acceptance report not found",
        )


@router.get(
    "/{report_id}/export",
    summary="导出验收报告",
)
def export_report(
    report_id: UUID,
    db: Session = Depends(get_db),
):
    """导出验收报告"""
    service = AcceptanceReportService(db)
    report_data = service.export_report(report_id)
    if not report_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Acceptance report not found",
        )
    return report_data
