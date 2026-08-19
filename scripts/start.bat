@echo off
REM Set console to UTF-8 encoding
chcp 65001 >nul

REM Quantitative Trading Platform - Start Script
REM Usage: start.bat

title Quantitative Trading Platform - Start

echo =========================================
echo   Quantitative Trading Platform - Start
echo =========================================
echo.
echo Starting services, please wait...
echo.

REM Get project root directory
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

echo Project root: "%PROJECT_ROOT%"
echo.

REM Check Docker status
echo [1/5] Checking Docker status...
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running, please start Docker Desktop first
    echo.
    pause
    exit /b 1
)
echo [OK] Docker is running

REM Start PostgreSQL
echo.
echo [2/5] Starting PostgreSQL database...
docker ps -a --filter "name=quant_trading_postgres" --format "{{.Status}}" | findstr "Up" >nul 2>&1
if errorlevel 1 (
    docker start quant_trading_postgres
    if errorlevel 1 (
        echo [ERROR] PostgreSQL start failed
        echo.
        pause
        exit /b 1
    )
    echo [OK] PostgreSQL started successfully
) else (
    echo [OK] PostgreSQL is already running
)

REM Check Python virtual environment
echo.
echo [3/5] Checking Python virtual environment...
if exist "%PROJECT_ROOT%\backend\.venv" (
    echo [OK] Python virtual environment exists
) else (
    echo [INFO] Python virtual environment does not exist, creating...
    py -3.14 -m venv "%PROJECT_ROOT%\backend\.venv"
    if errorlevel 1 (
        echo [ERROR] Python virtual environment creation failed
        echo.
        pause
        exit /b 1
    )
    echo [OK] Python virtual environment created successfully
)

REM Install Python dependencies
echo.
echo [4/5] Installing Python dependencies...
set "PYTHON_EXE=%PROJECT_ROOT%\backend\.venv\Scripts\python.exe"

if exist "%PYTHON_EXE%" (
    echo [OK] Python version:
    "%PYTHON_EXE%" --version
    
    REM Check if dependencies are installed
    if exist "%PROJECT_ROOT%\backend\.venv\Lib\site-packages\fastapi" (
        echo [OK] Python dependencies are installed
    ) else (
        echo [INFO] Installing Python dependencies...
        "%PYTHON_EXE%" -m pip install -r "%PROJECT_ROOT%\backend\requirements.txt"
        if errorlevel 1 (
            echo [ERROR] Python dependencies installation failed
            echo.
            pause
            exit /b 1
        )
        echo [OK] Python dependencies installed successfully
    )
    
    REM Install local package
    echo [INFO] Installing quant_trading package...
    "%PYTHON_EXE%" -m pip install --no-deps -e "%PROJECT_ROOT%\backend"
    if errorlevel 1 (
        echo [ERROR] quant_trading package installation failed
        echo.
        pause
        exit /b 1
    )
    echo [OK] quant_trading package installed successfully
) else (
    echo [ERROR] Python virtual environment not found
    echo.
    pause
    exit /b 1
)

REM Start API service
echo.
echo [5/5] Starting services...
echo Starting API service (port 8000)...

REM Create logs directory
if not exist "%PROJECT_ROOT%\logs" mkdir "%PROJECT_ROOT%\logs"

REM Start API service (background)
start "API Service" /MIN cmd /k ""%PYTHON_EXE%" "%PROJECT_ROOT%\backend\quant_trading\main_uvicorn.py""

REM Wait 3 seconds to check if service started
timeout /t 3 /nobreak >nul

echo.
echo =========================================
echo   Service started successfully!
echo =========================================
echo.
echo API Service: http://localhost:8000
echo API Docs:    http://localhost:8000/docs
echo.
echo Log files:
echo   - API log:    "%PROJECT_ROOT%\logs\api.log"
echo   - API error:  "%PROJECT_ROOT%\logs\api_error.log"
echo.
echo.
echo =========================================
echo   Important Notes
echo =========================================
echo.
echo 1. API service is running in background (minimized window)
echo 2. To view API logs, check logs\api.log file
echo 3. To stop API service, close the API service window
echo 4. To stop all services, run: stop.bat
echo.
echo =========================================
echo.

REM Keep window open
pause
