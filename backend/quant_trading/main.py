"""Main application entry point"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from quant_trading.api.v1.router import api_router
from quant_trading.config import settings

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