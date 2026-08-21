"""Strategies API endpoints"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from quant_trading.core.database import get_db

router = APIRouter()


@router.get("")
def list_strategies(db: Session = Depends(get_db)):
    """List all strategies"""
    # TODO: Implement real logic
    return {"data": [], "total": 0}


@router.post("")
def create_strategy(db: Session = Depends(get_db)):
    """Create a new strategy"""
    # TODO: Implement real logic
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{strategy_id}")
def get_strategy(strategy_id: str, db: Session = Depends(get_db)):
    """Get strategy by ID"""
    # TODO: Implement real logic
    raise HTTPException(status_code=404, detail="Strategy not found")


@router.get("/{strategy_id}/versions")
def list_strategy_versions(strategy_id: str, db: Session = Depends(get_db)):
    """List strategy versions"""
    # TODO: Implement real logic
    return {"data": [], "total": 0}