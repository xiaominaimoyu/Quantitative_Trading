@echo off
REM 设置控制台使用UTF-8编码
chcp 65001 >nul

REM 一键启动量化交易平台
REM 使用方法: start.bat

echo =========================================
echo   量化交易平台 - 一键启动脚本
echo =========================================
echo.

REM 获取项目根目录
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

echo 项目根目录: %PROJECT_ROOT%
echo.

REM 检查Docker是否运行
echo [1/5] 检查Docker状态...
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker未运行，请先启动Docker Desktop
    pause
    exit /b 1
)
echo ✅ Docker运行正常

REM 启动PostgreSQL
echo.
echo [2/5] 启动PostgreSQL数据库...
docker ps -a --filter "name=quant_trading_postgres" --format "{{.Status}}" | findstr "Up" >nul 2>&1
if errorlevel 1 (
    docker start quant_trading_postgres
    if errorlevel 1 (
        echo ❌ PostgreSQL启动失败
        pause
        exit /b 1
    )
    echo ✅ PostgreSQL启动成功
) else (
    echo ✅ PostgreSQL已运行
)

REM 检查Python虚拟环境
echo.
echo [3/5] 检查Python虚拟环境...
if exist "%PROJECT_ROOT%\backend\.venv" (
    echo ✅ Python虚拟环境已存在
) else (
    echo ⚠️ Python虚拟环境不存在，正在创建...
    py -3.14 -m venv "%PROJECT_ROOT%\backend\.venv"
    if errorlevel 1 (
        echo ❌ Python虚拟环境创建失败
        pause
        exit /b 1
    )
    echo ✅ Python虚拟环境创建成功
)

REM 安装Python依赖
echo.
echo [4/5] 安装Python依赖...
set "PYTHON_EXE=%PROJECT_ROOT%\backend\.venv\Scripts\python.exe"

if exist "%PYTHON_EXE%" (
    for /f "%%i in ('%PYTHON_EXE% --version 2^>^&1') do set "PYTHON_VERSION=%%i"
    echo ✅ Python版本: %PYTHON_VERSION%
    
    REM 检查是否已安装依赖
    if exist "%PROJECT_ROOT%\backend\.venv\Lib\site-packages\fastapi" (
        echo ✅ Python依赖已安装
    ) else (
        echo ⚠️ 正在安装Python依赖...
        %PYTHON_EXE% -m pip install -r "%PROJECT_ROOT%\backend\requirements.txt"
        if errorlevel 1 (
            echo ❌ Python依赖安装失败
            pause
            exit /b 1
        )
        echo ✅ Python依赖安装成功
    )
    
    REM 安装本地包
    echo ⚠️ 安装quant_trading包...
    %PYTHON_EXE% -m pip install --no-deps -e "%PROJECT_ROOT%\backend"
    if errorlevel 1 (
        echo ❌ quant_trading包安装失败
        pause
        exit /b 1
    )
    echo ✅ quant_trading包安装成功
) else (
    echo ❌ Python虚拟环境未找到
    pause
    exit /b 1
)

REM 启动API服务
echo.
echo [5/5] 启动服务...
echo 启动API服务 (端口8000)...

REM 创建日志目录
if not exist "%PROJECT_ROOT%\logs" mkdir "%PROJECT_ROOT%\logs"

REM 启动API服务（后台运行）
start "API服务" /MIN "%PYTHON_EXE%" "%PROJECT_ROOT%\backend\quant_trading\main_uvicorn.py"

REM 等待3秒检查服务是否启动
timeout /t 3 /nobreak >nul

echo.
echo =========================================
echo   🚀 服务启动完成！
echo =========================================
echo.
echo API服务: http://localhost:8000
echo API文档: http://localhost:8000/docs
echo.
echo 日志文件:
echo   - API日志: %PROJECT_ROOT%\logs\api.log
echo   - API错误: %PROJECT_ROOT%\logs\api_error.log
echo.
echo 要停止服务，请运行: stop.bat
echo.
pause
