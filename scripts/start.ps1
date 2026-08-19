# 一键启动量化交易平台
# 使用方法: .\start.ps1

Write-Host "========================================="
Write-Host "  量化交易平台 - 一键启动脚本" -ForegroundColor Green
Write-Host "========================================="
Write-Host ""

# 检查Docker是否运行
Write-Host "[1/5] 检查Docker状态..." -ForegroundColor Yellow
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Docker未运行，请先启动Docker Desktop" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Docker运行正常" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker未运行，请先启动Docker Desktop" -ForegroundColor Red
    exit 1
}

# 启动PostgreSQL
Write-Host ""
Write-Host "[2/5] 启动PostgreSQL数据库..." -ForegroundColor Yellow
$postgresContainer = docker ps -a --filter "name=quant_trading_postgres" --format "{{.Status}}"
if ($postgresContainer -match "Up") {
    Write-Host "✅ PostgreSQL已运行" -ForegroundColor Green
} else {
    docker start quant_trading_postgres
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ PostgreSQL启动成功" -ForegroundColor Green
    } else {
        Write-Host "❌ PostgreSQL启动失败" -ForegroundColor Red
        exit 1
    }
}

# 检查Python环境
Write-Host ""
Write-Host "[3/5] 检查Python虚拟环境..." -ForegroundColor Yellow
if (Test-Path "backend\.venv") {
    Write-Host "✅ Python虚拟环境已存在" -ForegroundColor Green
} else {
    Write-Host "⚠️ Python虚拟环境不存在，正在创建..." -ForegroundColor Yellow
    py -3.14 -m venv backend\.venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Python虚拟环境创建失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Python虚拟环境创建成功" -ForegroundColor Green
}

# 安装Python依赖
Write-Host ""
Write-Host "[4/5] 安装Python依赖..." -ForegroundColor Yellow
if (Test-Path "backend\.venv\Scripts\python.exe") {
    $pythonVersion = & ".\backend\.venv\Scripts\python.exe" --version
    Write-Host "✅ Python版本: $pythonVersion" -ForegroundColor Green
    
    # 检查是否已安装依赖
    if (Test-Path "backend\.venv\Lib\site-packages\fastapi") {
        Write-Host "✅ Python依赖已安装" -ForegroundColor Green
    } else {
        Write-Host "⚠️ 正在安装Python依赖..." -ForegroundColor Yellow
        & ".\backend\.venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Python依赖安装失败" -ForegroundColor Red
            exit 1
        }
        Write-Host "✅ Python依赖安装成功" -ForegroundColor Green
    }
} else {
    Write-Host "❌ Python虚拟环境未找到，请先创建虚拟环境" -ForegroundColor Red
    exit 1
}

# 启动服务
Write-Host ""
Write-Host "[5/5] 启动服务..." -ForegroundColor Yellow

# 创建日志目录
if (-not (Test-Path "logs")) {
    New-Item -ItemType Directory -Path "logs" -Force | Out-Null
}

# 启动API服务
Write-Host "启动API服务 (端口8000)..." -ForegroundColor Yellow
$apiProcess = Start-Process -FilePath "backend\.venv\Scripts\python.exe" `
    -ArgumentList "-m uvicorn quant_trading.main:app --reload --port 8000 --host 0.0.0.0" `
    -RedirectStandardOutput "logs\api.log" `
    -RedirectStandardError "logs\api_error.log" `
    -WindowStyle Hidden -PassThru

Start-Sleep -Seconds 3
if ($apiProcess.HasExited) {
    Write-Host "❌ API服务启动失败，请检查 logs\api_error.log" -ForegroundColor Red
    exit 1
}
Write-Host "✅ API服务启动成功 (PID: $($apiProcess.Id))" -ForegroundColor Green

# 保存进程ID
$apiProcess.Id | Out-File "logs\api.pid"

# 显示启动成功信息
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  🚀 服务启动成功！" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "API服务: http://localhost:8000" -ForegroundColor Cyan
Write-Host "API文档: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "日志文件:" -ForegroundColor Yellow
Write-Host "  - API日志: logs\api.log"
Write-Host "  - API错误: logs\api_error.log"
Write-Host ""
Write-Host "停止服务请运行: .\stop.ps1" -ForegroundColor Yellow
Write-Host ""