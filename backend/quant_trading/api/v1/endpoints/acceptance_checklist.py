"""Checklist and Issue API endpoints"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from quant_trading.core.database import get_db
from quant_trading.schemas.acceptance import (
    ChecklistItemResponse,
    ChecklistItemCreate,
    ChecklistResult,
    IssueResponse,
    IssueCreate,
    IssueSeverity,
    IssueStatus,
)
from quant_trading.services.checklist_service import ChecklistService
from quant_trading.services.issue_service import IssueService
from quant_trading.services.acceptance_actor import get_acceptance_actor_id

router = APIRouter(prefix="", tags=["acceptance-checklists"])


@router.get(
    "/checklists",
    response_model=List[ChecklistItemResponse],
    summary="获取检查项列表",
)
def list_checklists(
    report_id: Optional[UUID] = Query(None),
    result: Optional[ChecklistResult] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=0, le=1000),
    db: Session = Depends(get_db),
):
    """获取检查项列表"""
    service = ChecklistService(db)
    checklists = service.list_checklists(
        report_id=report_id,
        result=result,
        skip=skip,
        limit=limit,
    )
    return checklists


@router.get(
    "/checklists/{checklist_id}",
    response_model=ChecklistItemResponse,
    summary="获取检查项详情",
)
def get_checklist(
    checklist_id: UUID,
    db: Session = Depends(get_db),
):
    """获取检查项详情"""
    service = ChecklistService(db)
    checklist = service.get_checklist(checklist_id)
    if not checklist:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checklist item not found",
        )
    return checklist


@router.patch(
    "/checklists/{checklist_id}/result",
    response_model=ChecklistItemResponse,
    summary="更新检查结果",
)
def update_checklist_result(
    checklist_id: UUID,
    result: ChecklistResult,
    notes: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """更新检查结果"""
    service = ChecklistService(db)
    checklist = service.execute_checklist(
        checklist_id=checklist_id,
        result=result,
        notes=notes,
        checked_by=get_acceptance_actor_id(db),
    )
    if not checklist:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checklist item not found",
        )
    return checklist


@router.post(
    "/checklists/batch-exec",
    response_model=List[ChecklistItemResponse],
    summary="批量执行检查项",
)
def batch_execute_checklists(
    checklist_ids: List[UUID],
    result: ChecklistResult,
    notes: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """批量执行检查项"""
    service = ChecklistService(db)
    checklists = service.batch_execute(
        checklist_ids=checklist_ids,
        result=result,
        notes=notes,
        checked_by=get_acceptance_actor_id(db),
    )
    return checklists


@router.post(
    "/issues",
    response_model=IssueResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建问题",
)
def create_issue(
    request: IssueCreate,
    db: Session = Depends(get_db),
):
    """创建问题"""
    service = IssueService(db)
    issue = service.create_issue(
        title=request.title,
        description=request.description,
        severity=request.severity,
        checklist_id=request.checklist_id,
        created_by=get_acceptance_actor_id(db),
    )
    return issue


@router.get(
    "/issues",
    response_model=List[IssueResponse],
    summary="获取问题列表",
)
def list_issues(
    severity: Optional[IssueSeverity] = Query(None),
    status: Optional[IssueStatus] = Query(None),
    assignee_id: Optional[UUID] = Query(None),
    checklist_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=0, le=1000),
    db: Session = Depends(get_db),
):
    """获取问题列表"""
    service = IssueService(db)
    issues = service.list_issues(
        severity=severity,
        status=status,
        assignee_id=assignee_id,
        checklist_id=checklist_id,
        skip=skip,
        limit=limit,
    )
    return issues


@router.get(
    "/issues/{issue_id}",
    response_model=IssueResponse,
    summary="获取问题详情",
)
def get_issue(
    issue_id: UUID,
    db: Session = Depends(get_db),
):
    """获取问题详情"""
    service = IssueService(db)
    issue = service.get_issue(issue_id)
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found",
        )
    return issue


@router.patch(
    "/issues/{issue_id}/status",
    response_model=IssueResponse,
    summary="更新问题状态",
)
def update_issue_status(
    issue_id: UUID,
    new_status: IssueStatus,
    db: Session = Depends(get_db),
):
    """更新问题状态"""
    service = IssueService(db)
    try:
        issue = service.update_status(issue_id, new_status)
        if not issue:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Issue not found",
            )
        return issue
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/issues/{issue_id}/link-checklist",
    response_model=IssueResponse,
    summary="关联检查项",
)
def link_checklist(
    issue_id: UUID,
    checklist_id: UUID,
    db: Session = Depends(get_db),
):
    """关联检查项"""
    service = IssueService(db)
    issue = service.link_checklist(issue_id, checklist_id)
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found",
        )
    return issue
