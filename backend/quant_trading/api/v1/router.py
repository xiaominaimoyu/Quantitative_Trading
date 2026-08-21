"""API v1 router"""

from fastapi import APIRouter

from quant_trading.api.v1.endpoints import acceptance_reports, acceptance_checklist, acceptance_dfx
from quant_trading.api.v1.endpoints import restored

api_router = APIRouter()

# Reconstructed B0--B5/G5 routes own the historical paths.  The older
# placeholder routers are deliberately not mounted, avoiding duplicate route
# registration while their compatibility paths are served by ``restored``.
api_router.include_router(restored.router, tags=["recovered"])

# G3/G4 Acceptance API
api_router.include_router(acceptance_reports.router, prefix="/acceptance/reports", tags=["acceptance-reports"])
api_router.include_router(acceptance_checklist.router, prefix="/acceptance/checklists", tags=["acceptance-checklists"])
api_router.include_router(acceptance_dfx.router, prefix="/acceptance/dfx", tags=["acceptance-dfx"])
