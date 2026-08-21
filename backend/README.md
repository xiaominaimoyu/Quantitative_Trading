# Quant Trading Backend

## 环境要求
- Python 3.12+
- PostgreSQL 14+

## 安装
```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install --no-deps -e .
```

## 配置
恢复后的应用只从进程环境读取配置，不会在导入或 OpenAPI 生成时自动读取
本地 `.env` 文件；部署时请显式提供 `DATABASE_URL` 与 `SECRET_KEY`。
开发 session 默认只在 development/dev/test 环境启用；未提供 `SECRET_KEY`
时开发进程使用随机、仅进程存活期有效的签名键。生产环境默认禁用开发
session，且应显式提供持久化的 `SECRET_KEY`。

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

## 恢复边界

G5/G6 仅提供确定性的本地模拟盘与安全护栏。应用不连接行情、券商或
xtquant，也没有实盘下单路径。详见 `../docs/RECOVERY_PROVENANCE.md`。
