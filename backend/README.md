# Quant Trading Backend

## 环境要求
- Python 3.12+
- PostgreSQL 14+

## 安装
```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install --no-deps -e .
```

## 配置
复制 `.env.example` 到 `.env` 并配置环境变量。

## 数据库迁移
```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

## 运行
```powershell
# API
.\.venv\Scripts\python.exe -m uvicorn quant_trading.main:app --reload --port 8000

# Worker
.\.venv\Scripts\python.exe -m quant_trading.worker
```