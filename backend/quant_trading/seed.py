"""Explicit development seed for deterministic local fixtures only.

Importing this module never opens a database and never provisions credentials.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from quant_trading.core.database import SessionLocal
from quant_trading.models.recovery import DataSource


FIXTURE_SOURCES = (
    ("Deterministic fixture (clean)", "active"),
    ("Deterministic fixture (blocked)", "active"),
)


def ensure_deterministic_fixture_sources(db: Session) -> list[DataSource]:
    """Create the two documented local fixture sources exactly once."""

    values: list[DataSource] = []
    for name, status in FIXTURE_SOURCES:
        source = db.scalar(select(DataSource).where(DataSource.name == name))
        if source is None:
            source = DataSource(
                name=name,
                adapter="deterministic_fixture",
                license_ref="reconstructed-local-fixture-no-credentials",
                status=status,
            )
            db.add(source)
            db.flush()
        else:
            # These exact names are reserved for reconstructed fixtures, so a
            # partial prior seed is repaired without introducing credentials.
            source.adapter = "deterministic_fixture"
        values.append(source)
    return values


def seed() -> None:
    """Seed only fixture metadata; schema setup remains an Alembic responsibility."""

    db = SessionLocal()
    try:
        ensure_deterministic_fixture_sources(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
