"""Deterministic local actor for preserved acceptance endpoints.

The legacy acceptance handlers previously wrote a fixed zero UUID into user
foreign-key columns.  A real local user record is created lazily instead, so
the preserved endpoints remain usable on a database with foreign keys enabled.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from quant_trading.models.user import User


_ACTOR_USERNAME = "acceptance-system"
_ACTOR_EMAIL = "acceptance-system@local.invalid"


def get_acceptance_actor_id(db: Session):
    """Return the lazily created local actor used by legacy acceptance writes."""

    actor = db.scalar(select(User).where(User.username == _ACTOR_USERNAME))
    if actor is None:
        actor = User(
            username=_ACTOR_USERNAME,
            email=_ACTOR_EMAIL,
            password_hash="disabled-local-acceptance-actor",
            full_name="Acceptance System",
            is_active=True,
            is_admin=False,
            role="system",
        )
        db.add(actor)
        db.flush()
    return actor.id
