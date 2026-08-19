# System Design Specification

## Architecture Overview

The system consists of the following components:

1. **Frontend** - React-based single-page application
2. **Backend API** - FastAPI-based REST API
3. **Worker** - Background task processing
4. **Database** - PostgreSQL for data persistence
5. **DuckDB** - Immutable snapshot storage

## Technology Stack

### Backend
- Python 3.12+
- FastAPI
- SQLAlchemy
- PostgreSQL
- Alembic (migrations)

### Frontend
- React 19
- TypeScript
- Vite
- Ant Design
- ECharts

### Infrastructure
- Docker / Docker Compose
- PostgreSQL

## Data Flow

1. Frontend → Backend API (HTTP/REST)
2. Backend → PostgreSQL (persistence)
3. Backend → DuckDB (snapshots)
4. Worker → Background processing

## Security Considerations

- API authentication required for all endpoints
- Role-based access control (RBAC)
- Audit logging for all sensitive operations
- Input validation and sanitization