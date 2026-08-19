# ADR-002 - API Framework

## Status
Accepted

## Context
The backend API requires a framework that supports:
- RESTful API design
- Async support
- OpenAPI documentation
- Type hints

## Decision
Use FastAPI as the API framework.

### Rationale
1. **Performance**: Built on Starlette for excellent async performance
2. **OpenAPI**: Automatic OpenAPI documentation generation
3. **Type hints**: Native Python type hints for validation
4. **Async support**: First-class async/await support
5. **Developer experience**: Excellent developer experience with auto-reload

## Consequences

### Positive
- Fast development cycle
- Automatic API documentation
- Strong type safety
- Excellent async support

### Negative
- Relatively new framework compared to Flask/Django
- Smaller ecosystem of extensions

## Alternatives Considered
- Flask: Mature ecosystem but lacks async support
- Django REST Framework: Full-featured but heavier
- Starlette: FastAPI is built on it, but less convenient