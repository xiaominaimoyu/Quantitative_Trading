"""Alembic configuration"""

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

from quant_trading.config import settings
from quant_trading.core.database import Base
from quant_trading.models import (
    User,
    AcceptanceReport,
    ChecklistItem,
    Issue,
    Signature,
    TestResult,
)
from quant_trading.models.recovery import (  # noqa: F401 - register metadata
    Artifact,
    AuditEvent,
    DataQualityRun,
    DataSource,
    Dataset,
    DatasetVersion,
    Experiment,
    IdempotencyRecord,
    PaperAccount,
    PaperFill,
    PaperOrder,
    ReconciliationRun,
    Report,
    ResearchContainer,
    ResearchVersion,
    RiskEvent,
    SafetyState,
    Task,
    ValidationRun,
)

# this is the Alembic Config object
config = context.config

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here for 'autogenerate' support
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = settings.DATABASE_URL
    
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
