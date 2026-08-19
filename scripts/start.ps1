# 一键启动量化交易平台
# 使用方法: .\start.ps1

# 获取脚本所在目录的父目录（项目根目录）
$ScriptDir = Split-Path -Parent $PSScriptRoot
$ProjectRoot = $ScriptDir

Write-Host "========================================="
Write-Host "  量化交易平台 - 一键启动脚本" -ForegroundColor Green
Write-Host "========================================="
Write-Host ""
Write-Host "项目根目录: $ProjectRoot" -ForegroundColor Cyan
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
$venvPath = Join-Path $ProjectRoot "backend\.venv"
if (Test-Path $venvPath) {
    Write-Host "✅ Python虚拟环境已存在" -ForegroundColor Green
} else {
    Write-Host "⚠️ Python虚拟环境不存在，正在创建..." -ForegroundColor Yellow
    $backendDir = Join-Path $ProjectRoot "backend"
    py -3.14 -m venv $venvPath
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Python虚拟环境创建失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Python虚拟环境创建成功" -ForegroundColor Green
}

# 安装Python依赖
Write-Host ""
Write-Host "[4/5] 安装Python依赖..." -ForegroundColor Yellow
$pythonExe = Join-Path $venvPath "Scripts\python.exe"
if (Test-Path $pythonExe) {
    $pythonVersion = & $pythonExe --version
    Write-Host "✅ Python版本: $pythonVersion" -ForegroundColor Green
    
    # 检查是否已安装依赖
    $fastapiPath = Join-Path $venvPath "Lib\site-packages\fastapi"
    if (Test-Path $fastapiPath) {
        Write-Host "✅ Python依赖已安装" -ForegroundColor Green
    } else {
        Write-Host "⚠️ 正在安装Python依赖..." -ForegroundColor Yellow
        $requirementsPath = Join-Path $ProjectRoot "backend\requirements.txt"
        & $pythonExe -m pip install -r $requirementsPath
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
$logsPath = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logsPath)) {
    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
}

# 启动API服务
Write-Host "启动API服务 (端口8000)..." -ForegroundColor Yellow
$apiLogPath = Join-Path $logsPath "api.log"
$apiErrorLogPath = Join-Path $logsPath "api_error.log"

$apiProcess = Start-Process -FilePath $pythonExe `
    -ArgumentList "quant_trading\main_uvicorn.py" `
    -RedirectStandardOutput $apiLogPath `
    -RedirectStandardError $apiErrorLogPath `
    -WindowStyle Hidden -PassThru `
    -WorkingDirectory (Join-Path $ProjectRoot "backend")

Start-Sleep -Seconds 3
if ($apiProcess.HasExited) {
    Write-Host "❌ API服务启动失败，请检查 $apiErrorLogPath" -ForegroundColor Red
    exit 1
}
Write-Host "✅ API服务启动成功 (PID: $($apiProcess.Id))" -ForegroundColor Green

# 保存进程ID
$apiPidPath = Join-Path $logsPath "api.pid"
$apiProcess.Id | Out-File $apiPidPath

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
Write-Host "  - API日志: $apiLogPath"
Write-Host "  - API错误: $apiErrorLogPath"
Write-Host ""
Write-Host "停止服务请运行: .\stop.ps1" -ForegroundColor Yellow
Write-Host ""
