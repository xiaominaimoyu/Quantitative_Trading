"""User data model"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID

from quant_trading.core.database import Base


class User(Base):
    """用户模型"""

    __tablename__ = "users"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        unique=True,
        nullable=False,
    )

    # 用户名
    username = Column(String(100), unique=True, nullable=False, index=True)

    # 邮箱
    email = Column(String(255), unique=True, nullable=False, index=True)

    # 密码哈希
    password_hash = Column(String(255), nullable=False)

    # 全名
    full_name = Column(String(255), nullable=True)

    # 是否激活
    is_active = Column(Boolean, default=True)

    # 是否管理员
    is_admin = Column(Boolean, default=False)

    # 角色（用于RBAC）
    role = Column(String(50), nullable=True)

    # 创建时间
    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    # 更新时间
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username}, email={self.email})>"