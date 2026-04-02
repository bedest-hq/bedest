<p align="center">
  <img src="docs/images/bedest.png" alt="Bedest Logo" width="200" />
</p>

<h1 align="center">Bedest - B.E.D. Stack Boilerplate</h1>

<p align="center">
  <strong>
    A production-ready, strictly typed backend foundation built for B2B SaaS and scalable microservices.
  </strong>
  <br/>
  Powered by <b>B</b>un, <b>E</b>lysiaJS, and <b>D</b>rizzle ORM.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/ElysiaJS-black?style=for-the-badge&logo=elysia" alt="Elysia">
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TS">
</p>

---

## Architectural Philosophy

Bedest is engineered to solve the most grueling challenges of B2B SaaS development—Multi-tenancy, Row-Level Security (RLS), Role-Based Access Control (RBAC), and Plan Management—from day one. It enforces a **Strictly Typed** environment, eliminating `any` types in favor of robust runtime validation.

### Why Bedest?
* **Bulletproof Error Handling**: A centralized `ErrorHandler` with a recursive extraction logic that unmasks deep-nested Drizzle/Postgres errors into standard, frontend-friendly JSON.
* **Native Multi-Tenancy**: Data isolation is not just a `where` clause; it is enforced at the database level using **PostgreSQL Row-Level Security (RLS)**.
* **SaaS Ready**: Built-in `PlanGuard` for subscription-based feature gating and a system-wide `MaintenanceMode` for graceful downtime.

---

## Core Features

-   **Ultra Fast**: Leveraging Bun runtime and ElysiaJS for microsecond response times.
-   **True Isolation**: Automated tenant scoping via `UtilTenantScope` and RLS policies.
-   **Dual-Token Auth**: Secure Access/Refresh JWT flow with HTTP-only cookies and CSRF protection.
-   **Generic Service Pattern**: `ServiceBase` and `ServiceBaseTenant` to eliminate repetitive CRUD logic.
-   **Standardized API Contract**: All validation and system errors follow the `{ error, details: [] }` schema.
-   **Lightning Fast Tests**: Isolated database testing using **PGlite** (in-memory Postgres). No external DB required for CI/CD.
-   **Hybrid Storage Engine**: Zero-copy file uploads with AWS S3 / Minio support and a seamless Local Storage fallback.

---

## Folder Structure & Nomenclature

Bedest follows a strict Domain-Driven Design (DDD) modular structure.

* **S** → Database Schemas (e.g., `SUser`, `STenant`)
* **V** → Validation Objects (e.g., `VId`, `VEmail`, `VString`)
* **E** → Enums (e.g., `EUserRole`, `ETenantPlan`)
* **T** → Types (e.g., `TEnv`, `TDb`)

```plaintext
src/
├── app/               # Router, Context (JWT, Auth Logic), Swagger
├── common/            # Shared Guards, Interfaces, Base Services, Utils
├── features/          # Bounded Contexts (Auth, User, Tenant, Session)
│   └── [module]/
│       ├── enums/     # Domain specific enums
│       ├── routers/   # Elysia routes & validation schemas
│       ├── schemas/   # Drizzle table definitions & RLS policies
│       └── services/  # Core business logic
├── infrastructure/    # Database Manager, Env Validation, Error Handling
└── scripts/           # DB Reset, seed , Context Builders
```
---

## Technical Highlights

### Recursive Error Extraction
The ErrorHandler implementation utilizes a type-safe recursive strategy to traverse error layers. It effectively unmasks internal driver errors (from pg-driver or Drizzle) to extract specific database codes without exposing sensitive stack traces to the client.

### Semantic Status Codes
The API follows strict REST standards to provide meaningful feedback:
- 402 Payment Required: Triggered automatically when a tenant plan expires.
- 403 Forbidden: Returned for insufficient RBAC roles or plan-based feature restrictions.
- 503 Service Unavailable: Used during Maintenance Mode to signal temporary downtime.
- 409 Conflict: Maps unique constraint violations (like duplicate emails) from the database.

### Automated Tenant Scoping
Security is enforced at the transaction level. By using UtilTenantScope, every database query is wrapped in a session-local configuration that triggers PostgreSQL RLS policies, ensuring absolute data isolation between tenants.

### Hybrid Storage Strategy
A unified `StorageManager` dynamically routes file uploads to AWS S3 (or any S3-compatible service like Minio) if credentials are provided, gracefully falling back to Node.js Local Storage. It handles files using a zero-copy approach (`Buffer.from` over `ArrayBuffer`), ensuring high-performance I/O without unnecessary memory allocations.

---

## Quick Start

### Installation
```bash
bun install
cp .env.example .env
```

### Database Setup
```bash
bun run app:dev
```

### Development

```bash
bun run dev
```
Access the Swagger documentation at: http://localhost:3000/api/docs

## Testing
Bedest uses PGlite for lightning-fast, isolated database tests. Tests run against an in-memory instance, allowing for safe mutations and instant feedback without external dependencies.

```bash
bun run test
```

## Deployment
A multi-stage Dockerfile is provided, optimized for minimal image size and maximum security in production environments.

```bash
docker-compose up -d
```

## Scripts

| Command | Description |
| ------- | ----------- |
| bun run dev | Start development server with hot reload |
| bun run check | Run TypeScript type-check and ESLint |
| bun run test | Run isolated unit and integration tests |
| bun run db:generate | Generate Drizzle migrations |
| bun run db:migrate | Apply migrations to database |
| bun run dev:setup | Full rebuild: Reset, Migrate, and Seed |

---

## License
This project is licensed under the MIT License.
