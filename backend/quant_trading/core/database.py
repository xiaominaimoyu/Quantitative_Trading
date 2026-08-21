"""Database session and metadata configuration.

Creating a SQLAlchemy engine is lazy: this module deliberately performs no
connection attempt while the FastAPI application or its OpenAPI schema is
imported.  Tests replace ``get_db`` with an isolated SQLite session.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from quant_trading.config import settings

# Create engine
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    future=True,
)

# Create session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,
)

# Base class for models
class Base(DeclarativeBase):
    """Shared declarative metadata for preserved and reconstructed models."""

    pass


def get_db() -> Session:
    """Dependency for getting database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
