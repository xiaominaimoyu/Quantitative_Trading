from pathlib import Path
from tempfile import gettempdir
from typing import Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration.

    Recovery intentionally does not load a local ``.env`` file on import.
    Deployments may still provide these values through the process environment.
    This keeps OpenAPI generation and isolated tests free from an implicit local
    database connection or accidental credential ingestion.
    """

    # Database
    # A deployment must provide credentials through its environment.  The
    # local default is deliberately password-free and is never contacted on
    # application import.
    DATABASE_URL: str = Field(
        default="postgresql+psycopg://127.0.0.1:5432/quant_trading",
        validation_alias=AliasChoices("QUANT_DATABASE_URL", "DATABASE_URL"),
    )
    TEST_DATABASE_URL: Optional[str] = None

    # Security
    # When omitted in development, auth creates a process-local random signing
    # key.  Production deployments must explicitly supply a durable key.
    SECRET_KEY: Optional[str] = None
    ENVIRONMENT: str = Field(
        default="development",
        validation_alias=AliasChoices("QUANT_ENV", "ENVIRONMENT"),
    )
    DEV_SESSION_ENABLED: Optional[bool] = None

    # API
    API_V1_STR: str = "/api/v1"

    # Worker
    WORKER_ENABLED: bool = True
    WORKER_HEARTBEAT_SECONDS: int = Field(
        default=15,
        ge=1,
        le=3600,
        validation_alias=AliasChoices("QUANT_WORKER_HEARTBEAT_SECONDS", "WORKER_HEARTBEAT_SECONDS"),
    )
    TASK_LEASE_SECONDS: int = Field(
        default=60,
        ge=1,
        le=86400,
        validation_alias=AliasChoices("QUANT_TASK_LEASE_SECONDS", "TASK_LEASE_SECONDS"),
    )

    # Local reconstructed storage.  These are deliberately outside the
    # workspace by default, and no directory is created during import or GET.
    ARTIFACT_ROOT: Path = Field(
        default_factory=lambda: Path(gettempdir()) / "quant_trading_reconstructed" / "artifacts",
        validation_alias=AliasChoices("QUANT_ARTIFACT_ROOT", "ARTIFACT_ROOT"),
    )
    DATA_ROOT: Path = Field(
        default_factory=lambda: Path(gettempdir()) / "quant_trading_reconstructed" / "data",
        validation_alias=AliasChoices("QUANT_DATA_ROOT", "DATA_ROOT"),
    )

    # Logging
    LOG_LEVEL: str = "INFO"

    # Mode
    API_MODE: str = "mock"  # mock or real

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=None,
        extra="ignore",
    )

    @property
    def development_sessions_enabled(self) -> bool:
        """Return the explicit switch, or a conservative environment default."""

        if self.DEV_SESSION_ENABLED is not None:
            return self.DEV_SESSION_ENABLED
        return self.ENVIRONMENT.strip().lower() in {"development", "dev", "test"}


settings = Settings()
