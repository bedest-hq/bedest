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
* **Real-Time Ready**: Integrated WebSocket manager and notification system for live payload delivery directly to users or entire tenants.
* **Immutable Audit Trail**: An Aspect-Oriented, macro-driven system logging mechanism that automatically tracks "who did what" with 100% type safety.
* **Headless Architecture Support**: Built-in 2-step domain resolution logic allowing modern frontends to dynamically map custom URLs to tenant IDs securely.

---

## Core Features

* **Ultra Fast**: Leveraging the Bun runtime and ElysiaJS for microsecond response times.
* **True Isolation**: Automated tenant scoping via `UtilTenantScope` and PostgreSQL RLS policies (`set_config`).
* **Dual-Token Auth**: Secure Access/Refresh JWT flow utilizing HTTP-only, SameSite `lax` cookies.
* **Live Notifications**: Native Elysia WebSocket implementation (`/notifications/live`) with a persistence layer that broadcasts targeted events to specific users or tenant-wide topics.
* **Generic Service Pattern**: Extensible `ServiceBase` and `ServiceBaseTenant` classes to eliminate repetitive CRUD and pagination logic.
* **Standardized API Contract**: All validation and system errors reliably follow the `{ error, details: [] }` schema structure.
* **Lightning Fast Tests**: Isolated database testing using **PGlite** (in-memory Postgres). No external DB container is required for CI/CD pipelines.
* **Hybrid Storage Engine**: Zero-copy file uploads with AWS S3 / Minio support, complete with file streaming for viewing and downloading, plus a seamless Local Storage fallback.

---

## Folder Structure & Nomenclature

Bedest follows a strict Domain-Driven Design (DDD) modular structure.

* **S** → Database Schemas (e.g., `SUser`, `STenant`)
* **V** → Validation Objects (e.g., `VId`, `VEmail`, `VString`)
* **E** → Enums (e.g., `EUserRole`, `ETenantPlan`)
* **T** → Types (e.g., `TEnv`, `TDb`)

```plaintext
src/
├── app/               # App Router, Context Builder (JWT, Auth Injection), Swagger
├── common/            # Shared Constants, Guards (Role/Plan), Interfaces, Base Services, Utils
├── features/          # Bounded Contexts (Auth, Notification, Session, Storage, System, Tenant, User)
│   └── [module]/
│       ├── enums/     # Domain specific enums
│       ├── routers/   # Elysia routes & validation schemas
│       ├── schemas/   # Drizzle table definitions & RLS policies
│       └── services/  # Core business logic & database interactions
├── infrastructure/    # Database Manager, Env Validation, Error Handling, Logger, Storage, WebSockets
└── scripts/           # DB Reset, Seed execution, Storage teardown

```

---

## Technical Highlights

### Recursive Error Extraction

The ErrorHandler implementation utilizes a type-safe recursive strategy to traverse error layers. It effectively unmasks internal driver errors (from `pg` or Drizzle) to extract specific database codes (e.g., `23505` for Conflicts) without exposing sensitive stack traces to the client.

### Semantic Status Codes & Guards

The API follows strict REST standards enforced by Elysia macros:

* `402 Payment Required`: Triggered automatically via `MacroPlanGuard` when a tenant plan expires.
* `403 Forbidden`: Returned via `MacroRoleGuard` for insufficient RBAC roles or cross-tenant modification attempts.
* `503 Service Unavailable`: Used during Maintenance Mode to signal temporary downtime.
* `409 Conflict`: Maps unique constraint violations (like duplicate emails) dynamically.

### Automated Tenant Scoping

Security is enforced at the transaction level. By using `UtilTenantScope`, every database query is wrapped in a session-local configuration that triggers PostgreSQL RLS policies via `set_config('app.current_tenant', ...)` ensuring absolute data isolation between tenants, with an automatic `bypass_rls` fallback for `SYSTEM` level users.

### Real-Time Notification Engine

Bedest includes a dedicated `WsManager` tied to Elysia's native WebSocket support. `ServiceNotification` allows developers to persist and push live events (`publishToUser` / `publishToTenant`) across active WebSocket subscriptions concurrently.

### Hybrid Storage Strategy

A unified `StorageManager` dynamically routes file uploads to AWS S3 (or any S3-compatible service like Minio) if credentials are provided, gracefully falling back to Node.js Local Storage. It handles files using a zero-copy approach (`Buffer.from` over `ArrayBuffer`), ensuring high-performance I/O, and provides native HTTP header parsing for safe file downloads (`Content-Disposition: attachment`).

### Aspect-Oriented Audit Trail

Bedest introduces a highly sophisticated, macro-driven audit logging system. Instead of littering business logic with log statements, developers simply flag a route with `audit: true` or provide a custom configuration (`audit: { action: 'USER_BANNED' }`). The `PluginAudit` middleware automatically scrubs sensitive keys (passwords, tokens) and persists the user action into the database asynchronously.

### Headless Domain Resolution & Guest Access

Designed for decoupled frontend architectures (Next.js, Nuxt), Bedest implements a secure, 2-tier public access system. Frontends can resolve their runtime URL (`x-tenant-domain`) into a specific Tenant ID via a public endpoint (`/public/resolve`).

---

## Quick Start

### Installation

```bash
bun install
cp .env.example .env

```

### Database Setup

Spin up a local PostgreSQL instance:

```bash
docker run -d \
  --name postgres \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=postgres \
  postgres:16-alpine

```

Execute the full database setup (resets, generates, migrates, and seeds):

```bash
bun run dev:setup

```

### Development

```bash
bun run dev

```

Access the Swagger documentation at: `http://localhost:3000/api/docs`

## Testing

Bedest uses **PGlite** for lightning-fast, isolated database tests. Tests run against an in-memory instance, allowing for safe mutations, real schema checks, and instant feedback without requiring a running Docker container.

```bash
bun run test

```

## Deployment

A multi-stage Dockerfile is recommended, optimized for minimal image size and maximum security in production environments. Ensure you set `NODE_ENV=production` to enforce secure cookies and silent logging.

```bash
docker-compose up -d

```

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start development server with hot reload |
| `bun run build` | Compile the application into a standalone executable via Bun |
| `bun run check` | Run TypeScript type-check and ESLint |
| `bun run test` | Run isolated unit and integration tests via PGlite |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Apply migrations to the database |
| `bun run dev:setup` | Full rebuild: Reset DB/Storage, Migrate, and Seed initial data |

---

## License

This project is licensed under the MIT License.
