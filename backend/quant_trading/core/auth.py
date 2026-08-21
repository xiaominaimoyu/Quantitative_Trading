"""Small, local-only development-session authentication.

The retained frontend calls a development-session endpoint before authenticated
API calls.  This implementation uses an HMAC-signed, expiry-bearing token and
does not persist credentials or disclose token material in errors/audit data.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Annotated, Callable

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from quant_trading.config import settings
from quant_trading.core.errors import public_error


ROLE_SCOPES: dict[str, tuple[str, ...]] = {
    "researcher": ("research:read", "research:write", "paper:read"),
    "auditor": ("research:read", "audit:read", "paper:read"),
    "admin": (
        "research:read",
        "research:write",
        "audit:read",
        "paper:read",
        "paper:stop",
        "safety:recover",
        "admin",
    ),
}
TOKEN_TTL_SECONDS = 60 * 60
_PROCESS_SIGNING_KEY = secrets.token_bytes(32)
_bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="BearerAuth",
    description="Short-lived local development session bearer token.",
)


@dataclass(frozen=True, slots=True)
class Actor:
    login_name: str
    role: str
    scopes: tuple[str, ...]

    @property
    def key(self) -> str:
        return self.login_name

    def has(self, scope: str) -> bool:
        return "admin" in self.scopes or scope in self.scopes


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _signature(payload: bytes) -> bytes:
    configured = settings.SECRET_KEY
    key = configured.encode("utf-8") if configured else _PROCESS_SIGNING_KEY
    return hmac.new(key, payload, hashlib.sha256).digest()


def issue_dev_token(login_name: str, role: str, *, now: int | None = None) -> tuple[str, int, tuple[str, ...]]:
    """Issue a short-lived signed token for one of the documented dev roles."""

    if not settings.development_sessions_enabled:
        raise public_error(404, "DEV_SESSION_DISABLED", "Development sessions are disabled in this environment")
    if role not in ROLE_SCOPES:
        raise public_error(422, "INVALID_ROLE", "Unsupported development role")
    cleaned_name = login_name.strip()
    if not cleaned_name or len(cleaned_name) > 128:
        raise public_error(422, "INVALID_LOGIN_NAME", "login_name must be between 1 and 128 characters")
    issued_at = int(time.time() if now is None else now)
    expires_at = issued_at + TOKEN_TTL_SECONDS
    scopes = ROLE_SCOPES[role]
    payload = json.dumps(
        {"sub": cleaned_name, "role": role, "scopes": scopes, "exp": expires_at},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    token = f"{_b64encode(payload)}.{_b64encode(_signature(payload))}"
    return token, expires_at, scopes


def parse_dev_token(token: str, *, now: int | None = None) -> Actor:
    """Validate signature, expiry and role/scopes without logging token bytes."""

    try:
        payload_part, signature_part = token.split(".", 1)
        payload = _b64decode(payload_part)
        received = _b64decode(signature_part)
        expected = _signature(payload)
        parsed = json.loads(payload.decode("utf-8"))
        if not hmac.compare_digest(received, expected):
            raise ValueError("signature")
        role = parsed["role"]
        scopes = tuple(parsed["scopes"])
        if role not in ROLE_SCOPES or scopes != ROLE_SCOPES[role]:
            raise ValueError("role")
        if not isinstance(parsed["sub"], str) or not parsed["sub"]:
            raise ValueError("subject")
        if int(parsed["exp"]) <= int(time.time() if now is None else now):
            raise ValueError("expired")
    except (ValueError, KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise public_error(401, "INVALID_SESSION", "Development session is invalid or expired") from None
    return Actor(login_name=parsed["sub"], role=role, scopes=scopes)


def get_current_actor(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(_bearer_scheme)] = None,
) -> Actor:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise public_error(401, "UNAUTHENTICATED", "Authentication is required")
    return parse_dev_token(credentials.credentials.strip())


def require_scope(scope: str) -> Callable[[Actor], Actor]:
    def dependency(actor: Actor = Depends(get_current_actor)) -> Actor:
        if not actor.has(scope):
            raise public_error(403, "FORBIDDEN", "Permission is insufficient for this operation")
        return actor

    return dependency


def require_admin(actor: Actor = Depends(get_current_actor)) -> Actor:
    if actor.role != "admin":
        raise public_error(403, "ADMIN_REQUIRED", "Administrator permission is required")
    return actor
