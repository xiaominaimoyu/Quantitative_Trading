"""Runs API endpoints"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from quant_trading.core.database import get_db

router = APIRouter()


@router.get("")
def list_runs(db: Session = Depends(get_db)):
    """List all runs"""
    # TODO: Implement real logic
    return {"data": [], "total": 0}


@router.post("")
def create_run(db: Session = Depends(get_db)):
    """Create a new run"""
    # TODO: Implement real logic
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    """Get run by ID"""
    # TODO: Implement real logic
    raise HTTPException(status_code=404, detail="Run not found")