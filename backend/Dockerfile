FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock \
    && addgroup --gid 1000 quant \
    && adduser --disabled-password --gecos "" --uid 1000 --gid 1000 quant

COPY --chown=1000:1000 quant_trading ./quant_trading
COPY --chown=1000:1000 alembic ./alembic
COPY --chown=1000:1000 alembic.ini ./alembic.ini

USER 1000:1000

CMD ["python", "-m", "quant_trading.main"]
