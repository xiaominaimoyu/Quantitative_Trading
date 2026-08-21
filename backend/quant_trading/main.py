"""Main application entry point."""

from __future__ import annotations

import re
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from quant_trading.api.v1.router import api_router
from quant_trading.config import settings
from quant_trading.core.errors import APIError, ERROR_MESSAGES, envelope

app = FastAPI(
    title="Quant Trading Platform",
    description="A-share Daily Research Platform API",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Attach one sanitized request id to every public response."""

    supplied = request.headers.get("X-Request-Id", "")
    request_id = supplied if re.fullmatch(r"[A-Za-z0-9._-]{1,128}", supplied) else str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


@app.exception_handler(APIError)
async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return JSONResponse(
        status_code=exc.status_code,
        content=envelope(
            code=exc.code,
            message=exc.message,
            request_id=request_id,
            details=exc.details,
            retryable=exc.retryable,
        ),
        headers={"X-Request-Id": request_id},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    details = [
        {"field": ".".join(str(part) for part in error.get("loc", ())), "reason": str(error.get("msg", "invalid value"))}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=envelope(code="VALIDATION_ERROR", message="Request validation failed", request_id=request_id, details=details),
        headers={"X-Request-Id": request_id},
    )


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    code, message = ERROR_MESSAGES.get(exc.status_code, ("REQUEST_FAILED", "Request could not be processed"))
    return JSONResponse(
        status_code=exc.status_code,
        content=envelope(code=code, message=message, request_id=request_id),
        headers={"X-Request-Id": request_id},
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Do not expose exception text, connection strings, tokens or stack traces."""

    request_id = getattr(request.state, "request_id", str(uuid4()))
    return JSONResponse(
        status_code=500,
        content=envelope(code="INTERNAL_ERROR", message="The request could not be completed", request_id=request_id, retryable=False),
        headers={"X-Request-Id": request_id},
    )

# Include API router
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
def root():
    """Root endpoint with API information"""
    return {
        "name": "Quant Trading Platform",
        "version": "1.0.0",
        "description": "A-share Daily Research Platform API",
        "docs": "/docs",
        "health": "/health",
        "api": f"{settings.API_V1_STR}",
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "quant_trading.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
