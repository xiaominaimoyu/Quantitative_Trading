from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from quant_trading.core.database import Base
from quant_trading.models.user import User
from quant_trading.services.acceptance_actor import get_acceptance_actor_id


def test_acceptance_actor_is_a_real_stable_user() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[User.__table__])
    with Session(engine) as session:
        first = get_acceptance_actor_id(session)
        second = get_acceptance_actor_id(session)
        session.commit()
        assert first == second
        assert session.get(User, first).username == "acceptance-system"
