"""Experiments API endpoints"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from quant_trading.core.database import get_db

router = APIRouter()


@router.get("")
def list_experiments(db: Session = Depends(get_db)):
    """List all experiments"""
    # TODO: Implement real logic
    return {"data": [], "total": 0}


@router.post("")
def create_experiment(db: Session = Depends(get_db)):
    """Create a new experiment"""
    # TODO: Implement real logic
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{experiment_id}")
def get_experiment(experiment_id: str, db: Session = Depends(get_db)):
    """Get experiment by ID"""
    # TODO: Implement real logic
    raise HTTPException(status_code=404, detail="Experiment not found")


@router.get("/{experiment_id}/runs")
def list_experiment_runs(experiment_id: str, db: Session = Depends(get_db)):
    """List experiment runs"""
    # TODO: Implement real logic
    return {"data": [], "total": 0}