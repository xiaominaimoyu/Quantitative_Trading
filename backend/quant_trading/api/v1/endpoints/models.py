"""Models API endpoints"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from quant_trading.core.database import get_db

router = APIRouter()


@router.get("")
def list_models(db: Session = Depends(get_db)):
    """List all models"""
    # TODO: Implement real logic
    return {"data": [], "total": 0}


@router.post("")
def create_model(db: Session = Depends(get_db)):
    """Create a new model"""
    # TODO: Implement real logic
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{model_id}")
def get_model(model_id: str, db: Session = Depends(get_db)):
    """Get model by ID"""
    # TODO: Implement real logic
    raise HTTPException(status_code=404, detail="Model not found")


@router.get("/{model_id}/versions")
def list_model_versions(model_id: str, db: Session = Depends(get_db)):
    """List model versions"""
    # TODO: Implement real logic
    return {"data": [], "total": 0}