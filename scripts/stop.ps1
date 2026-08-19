# 一键停止量化交易平台
# 使用方法: .\stop.ps1

# 获取脚本所在目录的父目录（项目根目录）
$ScriptDir = Split-Path -Parent $PSScriptRoot
$ProjectRoot = $ScriptDir

Write-Host "========================================="
Write-Host "  量化交易平台 - 一键停止脚本" -ForegroundColor Green
Write-Host "========================================="
Write-Host ""
Write-Host "项目根目录: $ProjectRoot" -ForegroundColor Cyan
Write-Host ""

# 停止API服务
Write-Host "[1/2] 停止API服务..." -ForegroundColor Yellow
$apiPidPath = Join-Path $ProjectRoot "logs\api.pid"
if (Test-Path $apiPidPath) {
    $apiPid = Get-Content $apiPidPath
    $apiProcess = Get-Process -Id $apiPid -ErrorAction SilentlyContinue
    if ($apiProcess) {
        Stop-Process -Id $apiPid -Force -ErrorAction SilentlyContinue
        Write-Host "✅ API服务已停止 (PID: $apiPid)" -ForegroundColor Green
    } else {
        Write-Host "⚠️ API服务未运行" -ForegroundColor Yellow
    }
    Remove-Item $apiPidPath -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "⚠️ 未找到API进程ID文件" -ForegroundColor Yellow
}

# 停止所有Python进程（如果有残留）
$pythonProcesses = Get-Process -Name "python" -ErrorAction SilentlyContinue
if ($pythonProcesses) {
    foreach ($proc in $pythonProcesses) {
        # 检查是否是我们的后端进程
        $procPath = $proc.Path
        if ($procPath -and $procPath.Contains("quant_trading")) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Write-Host "✅ 已停止Python进程 (PID: $($proc.Id))" -ForegroundColor Green
        }
    }
}

# 停止PostgreSQL容器
Write-Host ""
Write-Host "[2/2] 停止PostgreSQL容器..." -ForegroundColor Yellow
$dockerStatus = docker ps -a --filter "name=quant_trading_postgres" --format "{{.Status}}"
if ($dockerStatus -match "Up") {
    docker stop quant_trading_postgres
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ PostgreSQL容器已停止" -ForegroundColor Green
    } else {
        Write-Host "❌ PostgreSQL容器停止失败" -ForegroundColor Red
    }
} else {
    Write-Host "✅ PostgreSQL容器未运行" -ForegroundColor Green
}

# 显示停止成功信息
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  ✅ 所有服务已停止！" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "重新启动请运行: .\start.ps1" -ForegroundColor Yellow
Write-Host ""
