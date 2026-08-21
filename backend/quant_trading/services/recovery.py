"""Reusable persistence helpers for the recovered research API."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, TypeVar

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from quant_trading.core.errors import public_error
from quant_trading.models.recovery import AuditEvent, IdempotencyRecord


T = TypeVar("T")


def jsonable(value: Any) -> Any:
    """Convert only public, value-like fields to JSON-safe deterministic data."""

    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(jsonable(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def page_window(page: int, page_size: int, *, max_page_size: int = 100) -> tuple[int, int]:
    if page < 1:
        raise public_error(422, "INVALID_PAGE", "page must be at least 1")
    if page_size < 1 or page_size > max_page_size:
        raise public_error(422, "INVALID_PAGE_SIZE", f"page_size must be between 1 and {max_page_size}")
    return (page - 1) * page_size, page_size


def page_response(items: list[T], page: int, page_size: int, serializer: Callable[[T], Any]) -> dict[str, Any]:
    offset, limit = page_window(page, page_size)
    sliced = items[offset : offset + limit]
    return {
        "items": [serializer(item) for item in sliced],
        "page": {
            "has_more": offset + limit < len(items),
            "next_cursor": page + 1 if offset + limit < len(items) else None,
        },
    }


def cursor_page_response(items: list[T], cursor: int | None, page_size: int, serializer: Callable[[T], Any]) -> dict[str, Any]:
    if page_size < 1 or page_size > 100:
        raise public_error(422, "INVALID_PAGE_SIZE", "page_size must be between 1 and 100")
    start = 0 if cursor is None else cursor
    if start < 0:
        raise public_error(422, "INVALID_CURSOR", "cursor must not be negative")
    sliced = items[start : start + page_size]
    next_cursor = start + page_size if start + page_size < len(items) else None
    return {"items": [serializer(item) for item in sliced], "page": {"has_more": next_cursor is not None, "next_cursor": next_cursor}}


def append_audit(
    db: Session,
    *,
    actor_key: str,
    action: str,
    target: str,
    business_id: str | None = None,
    request_id: str | None = None,
    reason: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AuditEvent:
    """Append, never mutate: callers receive the persisted audit event id."""

    event = AuditEvent(
        actor_key=actor_key,
        action=action,
        target=target,
        business_id=business_id,
        request_id=request_id,
        reason=reason,
        before_json=jsonable(before) if before is not None else None,
        after_json=jsonable(after) if after is not None else None,
    )
    db.add(event)
    db.flush()
    return event


def execute_idempotent(
    db: Session,
    *,
    actor_key: str,
    operation: str,
    key: str,
    payload: Any,
    handler: Callable[[], tuple[dict[str, Any], int]],
) -> tuple[dict[str, Any], int, bool]:
    """Run a mutation once and replay its public result on a matching retry."""

    clean_key = key.strip() if key else ""
    if not clean_key or len(clean_key) > 255:
        raise public_error(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be between 1 and 255 characters")
    payload_sha256 = content_hash(payload)
    existing = db.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.actor_key == actor_key,
            IdempotencyRecord.operation == operation,
            IdempotencyRecord.idempotency_key == clean_key,
        )
    )
    if existing is not None:
        if existing.payload_sha256 != payload_sha256:
            raise public_error(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request payload")
        return existing.response_json, existing.status_code, True

    response, status_code = handler()
    db.flush()
    record = IdempotencyRecord(
        actor_key=actor_key,
        operation=operation,
        idempotency_key=clean_key,
        payload_sha256=payload_sha256,
        status_code=status_code,
        response_json=jsonable(response),
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raced = db.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.actor_key == actor_key,
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.idempotency_key == clean_key,
            )
        )
        if raced is not None and raced.payload_sha256 == payload_sha256:
            return raced.response_json, raced.status_code, True
        raise public_error(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key conflicts with a concurrent request") from None
    return jsonable(response), status_code, False
