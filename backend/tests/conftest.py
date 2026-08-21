"""Isolated SQLite fixtures for reconstructed backend tests.

The fixture deliberately creates only recovery tables and overrides FastAPI's
database dependency, so no test reads configuration from a developer database
or attempts a PostgreSQL connection.
"""

from __future__ import annotations

from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from quant_trading.config import settings
from quant_trading.core.database import Base, get_db
from quant_trading.main import app
from quant_trading.models.recovery import RECOVERY_TABLES
from quant_trading.seed import ensure_deterministic_fixture_sources
from quant_trading.worker import Worker


@pytest.fixture()
def storage_roots(tmp_path, monkeypatch) -> tuple[str, str]:
    """Route all reconstructed worker files to an isolated test directory."""

    artifact_root = tmp_path / "artifacts"
    data_root = tmp_path / "data"
    monkeypatch.setattr(settings, "ARTIFACT_ROOT", artifact_root)
    monkeypatch.setattr(settings, "DATA_ROOT", data_root)
    return str(artifact_root), str(data_root)


@pytest.fixture()
def session_factory(storage_roots: tuple[str, str]) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=RECOVERY_TABLES)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    setup_db = factory()
    try:
        ensure_deterministic_fixture_sources(setup_db)
        setup_db.commit()
    finally:
        setup_db.close()
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    def override() -> Generator[Session, None, None]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    with TestClient(app) as value:
        yield value
    app.dependency_overrides.clear()


@pytest.fixture()
def worker(session_factory: sessionmaker[Session], storage_roots: tuple[str, str]) -> Worker:
    artifact_root, data_root = storage_roots
    return Worker(
        session_factory=session_factory,
        worker_id="test-worker",
        artifact_root=artifact_root,
        data_root=data_root,
        lease_seconds=5,
    )


@pytest.fixture()
def headers(client: TestClient) -> Callable[[str], dict[str, str]]:
    def issue(role: str = "researcher") -> dict[str, str]:
        response = client.post("/api/v1/auth/dev-session", json={"login_name": f"test-{role}", "role": role})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['token']}"}

    return issue
