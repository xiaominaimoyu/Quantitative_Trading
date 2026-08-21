from setuptools import setup, find_packages

setup(
    name="quant_trading",
    version="0.1.0",
    description="Quantitative Trading Platform",
    author="xiaominaimoyu",
    python_requires=">=3.12",
    packages=find_packages(),
    install_requires=[
        "fastapi>=0.109.0",
        "uvicorn[standard]>=0.27.0",
        "sqlalchemy>=2.0.0",
        "psycopg[binary]>=3.1.0",
        "alembic>=1.13.0",
        "pydantic>=2.5.0",
        "pydantic-settings>=2.1.0",
        "python-dotenv>=1.0.0",
        "duckdb>=1.5.5",
        "pyarrow>=24.0.0",
    ],
)
