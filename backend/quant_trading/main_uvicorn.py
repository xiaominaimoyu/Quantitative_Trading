"""UVicorn entry point with asyncio fix for Python 3.14 on Windows"""

import asyncio
import sys

# Fix for Python 3.14 Windows socketpair issue
if sys.platform == "win32" and sys.version_info >= (3, 14):
    # Use I/O Completion Proactor instead of Selector
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from quant_trading.main import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)