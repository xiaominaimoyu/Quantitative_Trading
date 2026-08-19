@echo off
REM 设置控制台使用UTF-8编码
chcp 65001 >nul

REM 一键停止量化交易平台
REM 使用方法: stop.bat

echo =========================================
echo   量化交易平台 - 一键停止脚本
echo =========================================
echo.

REM 获取项目根目录
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

echo 项目根目录: %PROJECT_ROOT%
echo.

REM 停止API服务
echo [1/2] 停止API服务...

REM 停止所有Python进程
taskkill /F /IM python.exe >nul 2>&1
if errorlevel 1 (
    echo ⚠️ API服务未运行
) else (
    echo ✅ API服务已停止
)

REM 停止PostgreSQL容器
echo.
echo [2/2] 停止PostgreSQL容器...
docker ps -a --filter "name=quant_trading_postgres" --format "{{.Status}}" | findstr "Up" >nul 2>&1
if errorlevel 1 (
    echo ✅ PostgreSQL容器未运行
) else (
    docker stop quant_trading_postgres >nul 2>&1
    if errorlevel 1 (
        echo ❌ PostgreSQL容器停止失败
    ) else (
        echo ✅ PostgreSQL容器已停止
    )
)

echo.
echo =========================================
echo   ✅ 所有服务已停止！
echo =========================================
echo.
echo 重新启动请运行: start.bat
echo.
pause