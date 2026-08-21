"""Public error vocabulary and request-safe exception helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class APIError(Exception):
    """An expected API failure that is safe to expose to a client."""

    status_code: int
    code: str
    message: str
    details: list[dict[str, str]] | None = None
    retryable: bool = False


def public_error(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[dict[str, str]] | None = None,
    retryable: bool = False,
) -> APIError:
    return APIError(status_code, code, message, details, retryable)


ERROR_MESSAGES: dict[int, tuple[str, str]] = {
    400: ("BAD_REQUEST", "Request could not be processed"),
    401: ("UNAUTHENTICATED", "Authentication is required"),
    403: ("FORBIDDEN", "Permission is insufficient for this operation"),
    404: ("NOT_FOUND", "Resource was not found"),
    409: ("CONFLICT", "Request conflicts with the current resource state"),
    422: ("VALIDATION_ERROR", "Request validation failed"),
}


def envelope(
    *,
    code: str,
    message: str,
    request_id: str,
    details: list[dict[str, str]] | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
        "request_id": request_id,
        "retryable": retryable,
    }
    if details:
        error["details"] = details
    return {"error": error}
