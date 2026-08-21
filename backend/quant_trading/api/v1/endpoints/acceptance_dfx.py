"""Signature and DFX API endpoints"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from quant_trading.core.database import get_db
from quant_trading.schemas.acceptance import (
    SignatureResponse,
    SignatureCreate,
    SignatureRole,
    TestResultResponse,
    TestResultCreate,
    TestType,
    TestResultStatus,
)
from quant_trading.services.signature_service import SignatureService
from quant_trading.services.dfx_service import DFXService
from quant_trading.services.acceptance_actor import get_acceptance_actor_id

router = APIRouter(prefix="", tags=["acceptance-dfx"])


@router.post(
    "/signatures",
    response_model=SignatureResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建签字记录",
)
def create_signature(
    request: SignatureCreate,
    db: Session = Depends(get_db),
):
    """创建签字记录"""
    service = SignatureService(db)
    try:
        signature = service.create_signature(
            report_id=request.report_id,
            role=request.role,
            signer_id=get_acceptance_actor_id(db),
            signature_data=request.signature_data,
            notes=request.notes,
        )
        return signature
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get(
    "/signatures",
    response_model=List[SignatureResponse],
    summary="获取签字列表",
)
def list_signatures(
    report_id: Optional[UUID] = Query(None),
    role: Optional[SignatureRole] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=0, le=1000),
    db: Session = Depends(get_db),
):
    """获取签字列表"""
    service = SignatureService(db)
    signatures = service.list_signatures(
        report_id=report_id,
        role=role,
        skip=skip,
        limit=limit,
    )
    return signatures


@router.get(
    "/signatures/{signature_id}",
    response_model=SignatureResponse,
    summary="获取签字详情",
)
def get_signature(
    signature_id: UUID,
    db: Session = Depends(get_db),
):
    """获取签字详情"""
    service = SignatureService(db)
    signature = service.get_signature(signature_id)
    if not signature:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signature not found",
        )
    return signature


@router.get(
    "/signatures/{signature_id}/verify",
    summary="验证签字有效性",
)
def verify_signature(
    signature_id: UUID,
    db: Session = Depends(get_db),
):
    """验证签字有效性"""
    service = SignatureService(db)
    is_valid = service.verify_signature(signature_id)
    return {"valid": is_valid}


# DFX验证接口

@router.post(
    "/dfx/performance/run",
    response_model=TestResultResponse,
    summary="执行性能测试",
)
def run_performance_test(
    request: TestResultCreate,
    db: Session = Depends(get_db),
):
    """执行性能测试"""
    service = DFXService(db)
    test_result = service.run_performance_test(
        config=request.metrics or {},
        test_name=request.test_name,
        report_id=request.report_id,
    )
    return test_result


@router.post(
    "/dfx/reliability/run",
    response_model=TestResultResponse,
    summary="执行可靠性测试",
)
def run_reliability_test(
    request: TestResultCreate,
    db: Session = Depends(get_db),
):
    """执行可靠性测试"""
    service = DFXService(db)
    test_result = service.run_reliability_test(
        config=request.metrics or {},
        test_name=request.test_name,
        report_id=request.report_id,
    )
    return test_result


@router.post(
    "/dfx/security/run",
    response_model=TestResultResponse,
    summary="执行安全性测试",
)
def run_security_test(
    request:TestResultCreate,
    db: Session = Depends(get_db),
):
    """执行安全性测试"""
    service = DFXService(db)
    test_result = service.run_security_test(
        config=request.metrics or {},
        test_name=request.test_name,
        report_id=request.report_id,
    )
    return test_result


@router.get(
    "/dfx/reports/{test_id}",
    summary="获取测试报告",
)
def get_test_report(
    test_id: UUID,
    db: Session = Depends(get_db),
):
    """获取测试报告"""
    service = DFXService(db)
    report = service.get_test_report(test_id)
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test result not found",
        )
    return report


@router.get(
    "/dfx/reports",
    response_model=List[TestResultResponse],
    summary="获取测试报告列表",
)
def list_test_reports(
    test_type: Optional[TestType] = Query(None),
    status: Optional[TestResultStatus] = Query(None),
    report_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=0, le=1000),
    db: Session = Depends(get_db),
):
    """获取测试报告列表"""
    service = DFXService(db)
    reports = service.list_test_reports(
        test_type=test_type,
        status=status,
        report_id=report_id,
        skip=skip,
        limit=limit,
    )
    return reports
