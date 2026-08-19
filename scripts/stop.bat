@echo off
REM Set console to UTF-8 encoding
chcp 65001 >nul

REM Quantitative Trading Platform - Stop Script
REM Usage: stop.bat

echo =========================================
echo   Quantitative Trading Platform - Stop
echo =========================================
echo.

REM Get project root directory
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

echo Project root: "%PROJECT_ROOT%"
echo.

REM Stop API service
echo [1/2] Stopping API service...

REM Stop all Python processes
taskkill /F /IM python.exe >nul 2>&1
if errorlevel 1 (
    echo [INFO] API service is not running
) else (
    echo [OK] API service stopped
)

REM Stop PostgreSQL container
echo.
echo [2/2] Stopping PostgreSQL container...
docker ps -a --filter "name=quant_trading_postgres" --format "{{.Status}}" | findstr "Up" >nul 2>&1
if errorlevel 1 (
    echo [OK] PostgreSQL container is not running
) else (
    docker stop quant_trading_postgres >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] PostgreSQL container stop failed
    ) else (
        echo [OK] PostgreSQL container stopped
    )
)

echo.
echo =========================================
echo   All services stopped!
echo =========================================
echo.
echo To restart, run: start.bat
echo.
pause
