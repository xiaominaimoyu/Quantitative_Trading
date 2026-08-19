# Requirements Analysis and Planning

## Project Overview

Quant Trading Platform is an auditable, reproducible quantitative research platform for A-share daily research.

## Current Status

| Scope | Status |
|-------|--------|
| B0/B1 API, PostgreSQL, Worker, artifact, OpenAPI/Frontend integration | Implemented with 2026-08-09 acceptance snapshot |
| B2 Immutable snapshot, Manifest, quality gate, lineage, DuckDB, data domain real UI | Two technical exit criteria passed |
| B2.1 Baseline closure | Accepted; root commit `b30f471`, see execution package evidence |
| G1 Requirements baseline / G2 System design | G1 approved; G2 conditionally approved for B3 local research MVP design scope |
| B3 Strategy/Model/Risk version, permissions/audit and three-domain real UI | Technical exit criteria passed; baseline anchor `b3-baseline` |
| B4 Experiment, backtest, task control | Technical exit criteria passed; baseline anchor `b4-baseline` |
| B5 Validation, report, and audit | Technical exit criteria passed; baseline anchor `b5-baseline` |
| B6 Production switchover, CI, backup, and SBOM | Technical exit criteria passed; baseline anchor `b6-baseline` |
| G3/G4 Business acceptance | Not started; does not constitute remote deployment, simulation, or production approval |
| AI assistant, simulation, production | Not in current scope; production explicitly not authorized |

## Development Environment

Current empirical baseline: Windows 11, Python 3.12, Node.js 24, npm, and Docker Desktop.

Ports required:
- 5432 (PostgreSQL)
- 8000 (API)
- 5173 (Frontend)

## Getting Started

See [README.md](../README.md) for detailed setup instructions.