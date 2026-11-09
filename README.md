<p align="center">
  <img src="docs/images/bedest.png" alt="Bedest Logo" width="200" />
</p>

<h1 align="center">Bedest - B.E.D. Stack Boilerplate</h1>

<p align="center">
  <strong>
    A strictly typed, multi-tenant backend foundation for B2B SaaS.
  </strong>
  <br/>
  Powered by <b>B</b>un, <b>E</b>lysiaJS, and <b>D</b>rizzle ORM on PostgreSQL.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/ElysiaJS-black?style=for-the-badge&logo=elysia" alt="Elysia">
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TS">
</p>

---

## Contents

- [What you get](#what-you-get)
- [Folder structure](#folder-structure--nomenclature)
- [Technical highlights](#technical-highlights)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Security model](#security-model)
- [Database roles & RLS](#database-roles--rls)
- [Deployment](#deployment)
- [Billing (Stripe webhooks)](#billing-stripe-webhooks)
- [Testing](#testing)
- [Scripts](#scripts)
- [Upgrading to this release](#upgrading-to-this-release)

## What you get

Bedest handles the hard parts of a B2B SaaS backend from day one: multi-tenancy enforced by PostgreSQL **row-level security**, role-based access control, plan gating, account flows and operations. The code is strictly typed (no `any`, TypeBox validation on every input).

The reusable building blocks (base services, tenant scoping, guards, validation primitives) live in the separate package [`bedest-core`](https://github.com/bedest-hq/bedest-core).

* **Tenant isolation in the database**: every tenant table has an RLS policy, RLS is forced (owners included), and the API connects as a non-privileged role. Queries run in `UtilTenantScope.tenantScope` (one tenant) or `systemScope` (explicit cross-tenant access).
* **Accounts**: HttpOnly cookie sessions with refresh-token rotation and reuse detection, session list and revocation, account lockout, password reset and invitations by e-mail.
* **Append-only audit trail**: routes declare `audit: { entity, action? }`; rows are written after the response with secrets scrubbed, and the database refuses `UPDATE`/`DELETE` on `system_audit_logs` (grants and a trigger).
* **Real time**: WebSocket notifications (`/api/v1/notifications/live`) per user or tenant, fanned out across nodes through Redis when configured; sockets close when their session is revoked or their access token expires.
* **Storage**: S3/MinIO or local disk, type allowlist and size limit, streamed downloads, presigned uploads that are verified before they become visible.
* **Operations**: health and readiness probes, graceful shutdown, request ids and one access-log line per request, background jobs with a cluster-wide lock, a migration runner, Stripe webhooks.

## Folder Structure & Nomenclature

* **S** → Database schemas (e.g. `SUser`, `STenant`)
* **V** → Validation objects (e.g. `VEmail`, `VPassword`)
* **E** → Enums (e.g. `EUserRole`, `ETenantPlan`)
* **T** → Types (e.g. `TEnv`)

```plaintext
src/
├── app/               # App factory (createApp), router, request context, CSRF/CORS/security plugins
├── common/            # Shared types, utilities and validations (VEnv); TestManager for tests
├── features/          # Bounded contexts: auth, billing, health, notification, session,
│   └── [module]/      #   storage, system, tenant, user
│       ├── enums/     # Domain enums (pg enums)
│       ├── routers/   # Elysia routes and their TypeBox schemas
│       ├── schemas/   # Drizzle tables, indexes and RLS policies
│       └── services/  # Business logic and database access
├── infrastructure/    # Database, env, errors, jobs, logger, mail, rate limiting, Redis, storage, WebSockets
└── scripts/           # Migrations, role provisioning, seed, resets, audit redaction
client/                # Type-only Eden Treaty client (imports `type App`)
```

`src/app/Context.ts` wires `MacroRoleGuard` and the session principal; `src/features/tenant/utils/UtilPlanGuard.ts` is the opt-in `PlanGuard` (no template route is plan-gated).

---

## Technical Highlights

### bedest-core

| Export | Description |
|---|---|
| `ServiceBase` / `ServiceBaseTenant` | Generic CRUD with pagination and soft delete; the tenant variant scopes every query to `c.tenantId` inside an RLS transaction |
| `UtilTenantScope` | `tenantScope` / `systemScope`: set `app.current_tenant` / `app.bypass_rls` for one transaction |
| `UtilDbSchema` | `tenantIsolationPolicy`, `activeIndex`, `activeUniqueIndex` |
| `UtilRouter` | `defPaginatedSchema` — typed paginated responses |
| `UtilAudit` | `scrub()` — redacts secrets (password, token, secret, cookie, session, …) before persistence |
| `MacroRoleGuard` / `MacroPlanGuard` | Elysia macros for roles and plans |
| `baseColumns` | `id`, `isDeleted`, `createdAt`, `updatedAt`, `deletedAt` |
| `IApp`, `ITenantApp`, `IUserApp`, `ITenantUserApp`, `ISession` | Context interfaces of every service method |
| `TDbOrTx` | A database handle or a transaction |
| `VId`, `VEmail`, `VString`, `VStr(max)`, `VQuery` | Validation primitives (`VStr(n)` bounds strings to their `varchar(n)` column) |

### Error responses

Every error has the same body:

```json
{ "error": "Bad Request", "message": "Validation failed", "details": [{ "field": "email", "message": "Expected string to match 'email' format" }] }
```

`error` is the HTTP reason phrase, `message` an optional explanation and `details` the invalid fields of a validation error. Throw HTTP errors with `UtilHttp.fail(status, message?, details?)`; the global `ErrorHandler` maps everything else (unknown routes, malformed bodies, Postgres errors such as `23505` → 409, `23503` → 400, `22001` → 400) to the same shape. Unexpected errors answer `{ "error": "Internal Server Error", "requestId": "…" }` only — the `requestId` matches the access log line. Clients get the type as `IApiError`.

### Status codes and guards

* `401` — missing, expired or revoked session (also locked accounts, with the same body as a wrong password).
* `402 Payment Required` — `PlanGuard`: the tenant's plan has expired.
* `403 Forbidden` — role (`MacroRoleGuard`), cross-tenant attempts, CSRF rejection, or `{ "message": "PLAN_UPGRADE_REQUIRED" }` from `PlanGuard`.
* `409 Conflict` — unique violations (e.g. an e-mail already in use), files in use, self-lockout protections.
* `429 Too Many Requests` — rate limits.
* `503 Service Unavailable` — maintenance mode (except SYSTEM users) and readiness failures.

### Tenant scoping

`UtilTenantScope.tenantScope(c, fn)` runs `fn` in a transaction with `set_config('app.current_tenant', c.tenantId, true)`; the RLS policies only show that tenant's rows. `systemScope(db, fn)` sets `app.bypass_rls` for explicit cross-tenant work (SYSTEM users, jobs, login). Unscoped queries see no rows.

### Real-time notifications

`WsManager` keeps one registry entry per connection. `ServiceNotification` persists events and pushes them to a user or a tenant topic; with `REDIS_URL` the push is published so every node delivers it. A socket closes with `4001` when its access token expires (the client refreshes and reconnects) and with `1008` when its session is revoked. Notifications are best-effort: a failed push never fails the calling request.

### Storage

`StorageManager` uses S3 (any S3-compatible store; `S3_FORCE_PATH_STYLE=true` for MinIO) when the `S3_*` credentials are set, otherwise `LOCAL_STORAGE_PATH`. Uploads are checked against `STORAGE_ALLOWED_TYPES` and `STORAGE_MAX_BYTES`; downloads are streamed from the provider (never buffered). Files are served with `X-Content-Type-Options: nosniff`, a sandboxing CSP and `Cross-Origin-Resource-Policy: same-site`; only JPEG/PNG/WebP/PDF are shown inline.

Presigned uploads: `POST /storage/presign-upload` (signs type and size) → client `PUT`s the file to the URL → `POST /storage/:id/complete` checks size and type and makes the file `READY`. Files that are never completed are removed after 24 hours; soft-deleted files are purged after `STORAGE_PURGE_AFTER_DAYS`.

### Audit trail

```ts
.put("/:id", handler, { audit: { entity: "user", targetTenant: "user" } })
.delete("/sessions/:id", handler, { audit: { entity: "session", action: "SESSION_REVOKED" } })
```

`PluginAudit` writes one row per mutating request after the response (failed requests as `FAILED_<METHOD>`), scrubbing secrets from the body with `UtilAudit.scrub()`. `targetTenant` records the tenant a SYSTEM user acted on. Security events (`LOGIN_FAILED`, `LOGIN_LOCKED`, `LOGOUT`, `PASSWORD_CHANGED`, `PASSWORD_RESET`, `ROLE_CHANGED`, `SESSION_REVOKED`, `INVITE_ACCEPTED`) are written by the services. Rows are append-only: the application role has only `SELECT, INSERT`, and a trigger rejects `UPDATE`/`DELETE` for every role unless a maintenance transaction sets `app.audit_maintenance` (used by `RedactAuditLogs`).

### Accounts

* **Sessions** — `GET /auth/sessions` (with `current`), `DELETE /auth/sessions/:id`, `POST /auth/logout-all { includeCurrent }`. A session records IP, user agent and `lastUsedAt` (written at most every 5 minutes).
* **Lockout** — 5 failed logins for one e-mail within 15 minutes lock it for 15 minutes (Redis counters, table fallback); a locked attempt costs the same as a wrong password and gets the same 401.
* **Password reset** — `POST /auth/password/forgot { email }` always answers `202`; the e-mail links to `APP_PUBLIC_URL/reset-password#token=…` (30 minutes, single use). `POST /auth/password/reset { token, password }` revokes every session of the user.
* **Invitations** — `POST /user/invite { email, role, name? }` (ADMIN/SYSTEM) creates an `INVITED` user and e-mails `APP_PUBLIC_URL/accept-invite#token=…` (7 days); `POST /auth/invite/accept { token, name, password }` activates and signs in. `POST /tenant` invites the new tenant's ADMIN this way.

Tokens travel in the URL fragment (never sent to servers) and only their SHA-256 is stored.

### Tenants

`DELETE /tenant/:id` (SYSTEM) soft-deletes the tenant and its active users, revokes their sessions and closes their sockets; `POST /tenant/:id/restore` brings back the tenant and exactly the users deleted with it.

### Headless domain resolution

Frontends resolve their host name to a tenant with `GET /api/v1/public/resolve` and the `x-tenant-domain` header (rate limited per IP, `RATE_LIMIT_TENANT_RESOLVE_PER_MIN`); it returns only `id`, `name` and `logoId`.

### Background jobs

`JobScheduler` runs, when `JOBS_ENABLED` is true: `sessions.cleanupExpired` (hourly), `storage.purgeDeleted` (daily), `storage.cleanupPending` (hourly), `tokens.cleanup` (hourly; rotated refresh tokens and used/expired account tokens), `notifications.retention` (daily, `NOTIFICATION_RETENTION_DAYS`) and `loginAttempts.cleanup` (hourly). Each run holds a Postgres advisory lock, so with several replicas a job runs on one node at a time.

### Client SDK

`client/` is a type-only [Eden Treaty](https://elysiajs.com/eden/treaty/overview) client built on `type App`; see `client/README.md`.

---

## Quick Start

Requirements: Bun **1.3.14** or newer (1.3.14 is pinned in the Dockerfile and CI and matches `bedest-core`'s `engines.bun`) and PostgreSQL 16. When you upgrade Bun, re-pin the Dockerfile and CI together.

```bash
bun install
cp .env.example .env   # then adjust it
```

Start PostgreSQL:

```bash
docker run -d --name postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres \
  postgres:16-alpine
```

Create the application role and login once (superuser credentials), then build the database:

```bash
DATABASE_ADMIN_USER=postgres DATABASE_ADMIN_PASSWORD=postgres bun run src/scripts/database/ProvisionRoles.ts
CONFIRM_RESET=<DATABASE_NAME> SEED_SYSTEM_EMAIL=admin@example.com bun run dev:setup
```

`dev:setup` resets the database and the local storage folder, migrates and seeds the SYSTEM user (`SEED_SYSTEM_EMAIL`; `SEED_SYSTEM_PASSWORD`, or a generated password printed once). The reset is refused when `NODE_ENV=production` and needs `CONFIRM_RESET` set to the database name (or `--yes` when a reset script is run directly).

```bash
bun run dev
```

OpenAPI documentation: `http://localhost:3000/api/docs` (outside production, or with `ENABLE_API_DOCS=true`). With `MAIL_PROVIDER=console` nothing is e-mailed: each message is logged as one redacted line.

---

## Environment variables

The server validates its environment once at start (`EnvManager`, schema `VEnv`) and reports every problem in one error. Values marked *script* are read only by the named scripts.

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | — | `development`, `test` or `production` (no default). |
| `PORT` | yes | — | HTTP port. |
| `CORS_ORIGINS` | in production | — | Allowed browser origins, comma-separated; no `*` in production. Also the CSRF allowlist. |
| `CORS_ORIGIN` | no | — | Deprecated (read with a warning for one release); use `CORS_ORIGINS`. |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME` | yes | — | PostgreSQL server and database. |
| `DATABASE_USER`, `DATABASE_PASSWORD` | yes | — | Runtime login: a member of `bedest_app`, never a superuser. |
| `DATABASE_SSL_MODE` | no | `verify-full` in production, else `disable` | `disable`, `require` (encrypted, certificate not verified) or `verify-full`. |
| `DATABASE_SSL_CA` | no | — | CA for `verify-full`: PEM content or a file path. |
| `SECRET_KEY`, `REFRESH_KEY` | yes | — | JWT secrets, ≥ 32 characters, different; `.env.example` placeholders are refused in production. |
| `JWT_ISSUER` | no | `bedest` | `iss` claim set and checked on every token. |
| `MAX_REQUEST_BODY_BYTES` | no | `10485760` | Largest request body; ≥ `STORAGE_MAX_BYTES` + 65536. |
| `LOG_LEVEL` | no | `info` (`silent` in test) | pino level. |
| `ENABLE_API_DOCS` | no | `false` | Serve `/api/docs` in production too. |
| `SHUTDOWN_TIMEOUT_MS` | no | `15000` | Deadline of the graceful shutdown. |
| `TRUST_PROXY_HOPS` | no | `0` | Trusted reverse proxies; > 0 takes the client IP from `X-Forwarded-For`. |
| `REDIS_URL` | no | — | Redis for rate limits, lockout counters, maintenance/session invalidation and WebSocket fan-out; memory/table fallbacks without it. |
| `RATE_LIMIT_LOGIN_PER_MIN` | no | `5` | Logins per minute per IP + e-mail. |
| `RATE_LIMIT_LOGIN_IP_PER_MIN` | no | `20` | Logins per minute per IP. |
| `RATE_LIMIT_REFRESH_PER_MIN` | no | `30` | Refreshes per minute per IP. |
| `RATE_LIMIT_TENANT_RESOLVE_PER_MIN` | no | `30` | Public tenant resolutions per minute per IP. |
| `RATE_LIMIT_PASSWORD_FORGOT_PER_MIN` | no | `5` | Password-reset requests per minute per IP. |
| `RATE_LIMIT_PASSWORD_FORGOT_PER_HOUR` | no | `3` | Password-reset requests per hour per e-mail. |
| `MAIL_PROVIDER` | yes | — | `smtp`, or `console` (development/test only; refused in production). |
| `APP_PUBLIC_URL` | yes | — | Public URL of the web app (http/https, no query or fragment); e-mail links point here. |
| `MAIL_FROM` | with smtp | — | Sender, e.g. `Bedest <no-reply@example.com>`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | with smtp | — | SMTP server and credentials. |
| `SMTP_SECURE` | no | `false` | TLS from the first byte (port 465); `false` uses STARTTLS when offered. |
| `LOCAL_STORAGE_PATH` | no | — | Local storage folder (used when S3 is not configured). |
| `STORAGE_ALLOWED_TYPES` | no | `image/jpeg,image/png,image/webp,application/pdf` | MIME allowlist for uploads and presigned uploads. |
| `STORAGE_MAX_BYTES` | no | `5242880` | Largest stored file. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | no | — | S3 storage (all but the endpoint required to enable it). |
| `S3_FORCE_PATH_STYLE` | no | `false` | Path-style URLs (MinIO); `false` = virtual-hosted (AWS). |
| `JOBS_ENABLED` | no | `true` | Run the background jobs on this node. |
| `STORAGE_PURGE_AFTER_DAYS` | no | `30` | Days before a soft-deleted file's object is purged. |
| `NOTIFICATION_RETENTION_DAYS` | no | `180` | Days before a notification is soft-deleted. |
| `BILLING_WEBHOOK_SECRET` | no | — | Stripe signing secret; without it the billing webhook is not mounted. |
| `DATABASE_MIGRATION_USER`, `DATABASE_MIGRATION_PASSWORD` | *script* | runtime login | Schema owner for drizzle-kit, the migration runner and `RedactAuditLogs`. |
| `DATABASE_MIGRATION_DIR` | *script* | `drizzle` | Migration folder of the runner. |
| `DATABASE_ADMIN_USER`, `DATABASE_ADMIN_PASSWORD` | *script* | — | Superuser for `ProvisionRoles`. |
| `SEED_SYSTEM_EMAIL` | *script* | — | E-mail of the seeded SYSTEM user (required by the seed). |
| `SEED_SYSTEM_PASSWORD` | *script* | generated | Its password; a random one is printed when unset. |
| `ALLOW_PRODUCTION_SEED` | *script* | `false` | Allow the seed with `NODE_ENV=production`. |
| `CONFIRM_RESET` | *script* | — | Must equal `DATABASE_NAME` for `db:reset` / `dev:setup`. |

---

## Security model

* **Cookies.** The access token (15 minutes) and the refresh token (7 days) are `HttpOnly` cookies, `Secure` in production. The access cookie is `SameSite=Lax` on `/`; the refresh cookie is `SameSite=Strict` and only sent to `/api/v1/auth`. Tokens are never returned in response bodies. JWTs carry and require `iss`, `aud` and `typ` (access vs refresh).
* **Sessions.** Every access token names a session row; revoked sessions (logout, revocation, password change or reset, role change, user or tenant deletion) stop working at the next request and their sockets are closed. A refresh rotates the session in one transaction; reusing a rotated refresh token revokes the whole token family.
* **CSRF.** In production a `POST`/`PUT`/`PATCH`/`DELETE` that carries an auth cookie must come from an origin in `CORS_ORIGINS` (`Origin`, or `Referer` without it); health checks and the Stripe webhook are exempt. `SameSite` cookies are the second layer.
* **CORS.** Only `CORS_ORIGINS`, with credentials; wildcards are refused in production.
* **Tenant isolation.** RLS on every tenant table, forced for owners, with the API connected as a `bedest_app` member (see below). The server refuses to start in production as a superuser or `BYPASSRLS` role.
* **Roles.** `SYSTEM` > `ADMIN` > `USER`. SYSTEM may grant any role, ADMIN only `USER`; nobody changes their own role or removes the last ADMIN of a tenant or the last SYSTEM user.
* **Passwords.** New passwords need 12–128 characters; hashes use `Bun.password` (argon2id). Logins without credentials are rejected (no seeded fallbacks).
* **Rate limits and lockout.** Login, refresh, tenant resolution and password-reset requests are limited (see the `RATE_LIMIT_*` variables; Redis-backed when available). Five failed logins lock an e-mail for 15 minutes; unknown e-mails are counted the same way.
* **Account tokens.** Reset and invitation tokens are 256-bit, single-use, stored as SHA-256, and travel in URL fragments.
* **Audit.** Append-only `system_audit_logs` (grants plus trigger); request bodies are scrubbed of secrets; failed logins record an e-mail hash, IP and user agent, never the password or address.
* **Headers.** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, and `Strict-Transport-Security` in production. File responses add a sandboxing CSP.
* **Logging.** One JSON line per request (method, route pattern, status, duration, user/tenant ids, `requestId`) — never bodies, cookies or query strings. An incoming `x-request-id` (8–128 safe characters) is reused, otherwise generated, and echoed in the response.
* **Uploads.** Type allowlist and size limit for direct and presigned uploads; presigned files stay invisible until verified; only the uploader or an ADMIN deletes a file, never while it is an avatar or logo.

## Database roles & RLS

Tenant isolation is enforced by PostgreSQL row-level security, which **superusers, table owners and `BYPASSRLS` roles silently skip**. Bedest therefore uses separate credentials:

| Role | Used by | Privileges |
| --- | --- | --- |
| Schema owner (`DATABASE_MIGRATION_USER`) | drizzle-kit, the migration runner, `RedactAuditLogs` | Owns the tables; runs DDL. |
| `bedest_app` (group role, `NOLOGIN NOSUPERUSER NOBYPASSRLS`) | — | `SELECT, INSERT, UPDATE, DELETE` on all tables, only `SELECT, INSERT` on `system_audit_logs`; future tables through default privileges. |
| Runtime login (`DATABASE_USER`) | The API server | Member of `bedest_app`, nothing else. |

Every tenant table has `FORCE ROW LEVEL SECURITY`, so even the owner is bound by the policies. `ProvisionRoles` creates `bedest_app` (if missing) and the `DATABASE_USER` login with `DATABASE_PASSWORD`; it is idempotent and can be re-run to rotate the password. At boot the server checks its own role: in production it **refuses to start** as a superuser or `BYPASSRLS` role, elsewhere it logs a warning.

In tests the application connection runs as `bedest_app` too, and `src/infrastructure/database/RLS.test.ts` proves for every tenant table that one tenant can neither read, change, delete nor insert another tenant's rows.

## Deployment

`docker-compose.yml` is a production-style stack: `db` and `redis` → `provision` (one-shot `dist/provision-roles.js`) → `migrate` (one-shot `dist/migrate.js` as the schema owner) → `api`. Copy `.env.example` to `.env` and set real values first: production needs `CORS_ORIGINS`, real `SECRET_KEY`/`REFRESH_KEY`, `MAIL_PROVIDER=smtp` with the `SMTP_*` variables and `MAIL_FROM`, and `APP_PUBLIC_URL`.

```bash
docker compose up -d
```

* **Build.** `bun run build` bundles the server (`dist/index.js`), the migration runner (`dist/migrate.js`) and the role provisioning (`dist/provision-roles.js`) with `bun build`; it does not produce a standalone executable. `bun run start` runs `dist/index.js` with `NODE_ENV=production`.
* **Migrations.** Never on server start: run `bun run db:migrate:prod` (or `dist/migrate.js`) as the schema owner before starting a new version. Committed migrations are never edited.
* **Health checks.** `GET /api/health/live` (process up) and `GET /api/health/ready` (database, Redis when configured, storage; `503` while shutting down or when a dependency fails). Point the orchestrator's liveness and readiness probes at them.
* **Shutdown.** On `SIGTERM`/`SIGINT` the server reports not-ready, stops accepting connections, closes sockets, stops the jobs and closes Redis and the database within `SHUTDOWN_TIMEOUT_MS`.
* **Replicas.** Configure `REDIS_URL` so rate limits, invalidations and WebSocket events are shared; jobs are safe on every node (advisory lock), or set `JOBS_ENABLED=false` on extra replicas.
* **Logs.** JSON lines on stdout at `LOG_LEVEL` (default `info`); production is not silent.

## Billing (Stripe webhooks)

`POST /api/v1/billing/webhook` exists only when `BILLING_WEBHOOK_SECRET` is set. Every request must carry a valid `Stripe-Signature` (HMAC-SHA256 over the exact raw body, 300 s tolerance); each event id is processed once (`billing_events`), and the tenant update, its audit row and the event record are written in one transaction. Unknown tenants or plans are acknowledged with `200 { ignored: true }` so Stripe stops retrying.

**API version.** Configure the endpoint with Stripe API version **`2025-03-31.basil`** or later. Billing periods are read from `items.data[].current_period_*` (basil) and, for older versions, from the subscription's top-level `current_period_*`; invoice subscriptions from `parent.subscription_details.subscription` (basil) or `subscription` (older).

**Metadata contract.** Put on the Checkout Session (and the Subscription):

| Key | Required | Meaning |
| --- | --- | --- |
| `metadata.tenantId` (or `client_reference_id` on the session) | yes, on checkout | Tenant UUID to bill. Later events also resolve the tenant by `customer` or subscription id. |
| `metadata.plan` | yes, on checkout | `BASIC`/`FREE`, `STANDARD`/`STARTER`/`GROWTH` or `PROFESSIONAL`/`PRO`/`ENTERPRISE`. On subscriptions the first item price's `metadata.plan`, `lookup_key` or `nickname` is used when `metadata.plan` is absent. Anything else is ignored (the plan never defaults to a paid tier). |

| Event | Effect |
| --- | --- |
| `checkout.session.completed` | Sets plan, customer and subscription id (from `.subscription` only); plan end defaults to +30 days until period events arrive. |
| `customer.subscription.created` / `.updated` | Sets plan and the billing period. |
| `customer.subscription.deleted` | Downgrades to `BASIC`. |
| `invoice.paid` | Extends `planEnd` to the end of the paid period (never shortens it). |
| `invoice.payment_failed` | Logged and audited (`PAYMENT_FAILED`); the plan is unchanged. |

## Testing

Tests run against **PGlite** (in-memory Postgres) with the real migrations; no database container is needed. Application queries run as `bedest_app`, so RLS is enforced in tests as in production.

```bash
bun run test       # all tests
bun run coverage   # with the coverage gate (≥ 80 % lines per file in src/features and src/infrastructure)
```

`src/common/tests/TestManager.test.ts` (preloaded) migrates the database, creates per-test fixtures with generated names (`test_tenant`, `test_user` — a plain `USER` — and `test_system_user`), and truncates everything after each test. Request a principal explicitly: `testHeaders()` (USER), `testSystemHeaders()`, `testAdminHeaders()`, `createTestUser(role)`, `createForeignTenant(role)`. External I/O (S3, SMTP, GitHub, Redis) is replaced by fakes; the mail outbox is `ProviderMailConsole.sent`.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Development server with reload |
| `bun run build` | Bundle `dist/index.js`, `dist/migrate.js`, `dist/provision-roles.js` with `bun build` |
| `bun run start` | Run the bundle with `NODE_ENV=production` |
| `bun run check` | Typecheck and ESLint (`--max-warnings=0`) |
| `bun run format` / `format:check` | Prettier write / verify |
| `bun run test` / `coverage` | Tests / tests with the coverage gate |
| `bun run db:generate` | Generate a migration from the schemas (`--name <reason>`; `--custom` for SQL) |
| `bun run db:migrate` | Apply migrations with drizzle-kit (development) |
| `bun run db:migrate:prod` | Migration runner for deployments (schema owner) |
| `bun run db:check` | drizzle-kit consistency check |
| `bun run db:seed` | Seed the SYSTEM user (`SEED_SYSTEM_EMAIL`) |
| `bun run db:reset` | Drop and re-create the database and delete `LOCAL_STORAGE_PATH` (refused in production; `CONFIRM_RESET=<DATABASE_NAME>`) |
| `bun run dev:setup` | Reset (same confirmation), migrate, seed |
| `bun run src/scripts/database/ProvisionRoles.ts` | Create/rotate `bedest_app` and the runtime login |
| `bun run src/scripts/audit/RedactAuditLogs.ts [--apply]` | Redact secrets in old audit rows (dry run without `--apply`) |

---

## Upgrading to this release

This release changes behaviour and configuration. Before deploying:

1. **Install bedest-core 2.0** once it is published (`bun install`); the template's `package.json` already asks for `^2.0.0`. See its [upgrade notes](https://github.com/bedest-hq/bedest-core#upgrading-from-1x-to-20) (`getFilters(c, id?)`, `403 PLAN_UPGRADE_REQUIRED` instead of `426`, ESM only).
2. **Set the new environment variables**: `NODE_ENV` (required, no default), `CORS_ORIGINS` (replaces `CORS_ORIGIN`), `DATABASE_SSL_MODE` (replaces `DATABASE_SSL`), `MAIL_PROVIDER`, `APP_PUBLIC_URL` and, for SMTP, `SMTP_*`/`MAIL_FROM`. Secrets shorter than 32 characters or equal to the placeholders are refused.
3. **Provision the database roles** (`ProvisionRoles`), point `DATABASE_USER` at the new runtime login and `DATABASE_MIGRATION_*` at the schema owner, then run the migrations as the owner. They add RLS forcing, append-only audit logs, new columns and tables, and clean up data where needed (duplicate e-mails soft-deleted, cross-tenant file references cleared, orphan sessions deleted).
4. **Redact old audit rows**: `bun run src/scripts/audit/RedactAuditLogs.ts`, then with `--apply`; rotate any password that may have been stored in clear.
5. **Update clients**:
   * Error bodies are always `{ error, message?, details?, requestId? }`.
   * `POST /auth/refresh` returns `{ success: true }`; tokens only travel in cookies. The refresh cookie moved to `Path=/api/v1/auth; SameSite=Strict`, and tokens need `iss`/`aud`/`typ`: every user signs in once after the deploy.
   * Plan checks answer `403 PLAN_UPGRADE_REQUIRED` instead of `426`.
   * New passwords need 12–128 characters.
   * `POST /tenant` returns `{ id }` only; the tenant ADMIN receives an invitation e-mail.
   * `GET /user` items carry `status` (`ACTIVE`/`INVITED`).
   * Audit configuration is `audit: { entity, action?, targetTenant? }` (no `audit: true`).
   * `DELETE /storage/:id` is limited to the uploader or an ADMIN (409 while the file is in use); avatars and logos must be `READY` files of the same tenant; presigned uploads need `POST /storage/:id/complete`.
   * `DELETE /tenant/:id` also soft-deletes the tenant's users (undo with `POST /tenant/:id/restore`).
6. **Custom storage providers** must implement `head(key)`.

The full list, with the finding ids, is in `CHANGELOG.md` under *Unreleased*.

---

## License

This project is licensed under the MIT License.
