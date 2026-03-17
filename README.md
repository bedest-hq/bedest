<p align="center">
  <img src="docs/images/bedest.png" alt="Bedest Logo" width="200" />
</p>

<h1 align="center">Bedest - B.E.D. Stack Boilerplate</h1>

<p align="center">
  <strong>
    A production-ready, strictly typed backend boilerplate built for B2B SaaS and scalable microservices.
  </strong>
  <br/>
  Powered by <b>B</b>un, <b>E</b>lysiaJS, and <b>D</b>rizzle ORM.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
</p>

---

Most boilerplates leave you to figure out multi-tenancy, role-based access control, and deployment on your own.  
Bedest is designed to skip the setup phase.

It enforces a strict Domain-Driven Design (DDD), provides built-in tenant isolation, and handles database indexing optimally.

Stop wrestling with configurations and focus on shipping your business logic.

---

## ✨ Core Features

- **Blazing Fast**: Built on top of Bun and ElysiaJS  
- **True Multi-Tenancy**: PostgreSQL Row-Level Security (RLS) with automated tenant filtering via `ServiceBase`  
- **End-to-End Type Safety**: Drizzle (DB), TypeBox (routing), Zod (env)  
- **Enterprise Auth & RBAC**: Dual-token JWT (Access + Refresh) stored in HTTP-only cookies with custom `RoleGuard`  
- **Strict Nomenclature**:  
  - `S` → Database Schemas  
  - `V` → Validation Objects  
- **CI/CD Ready**: Dockerized with GitHub Actions (lint, test via PGlite, deploy to GHCR)

---

## 🚀 Quick Start

### 1. Prerequisites

- Bun (v1.0+)
- PostgreSQL (or Docker)

### 2. Installation

```bash
git clone git@github.com:barisatay0/bedest.git my-app
cd my-app
bun install
````

### 3. Environment Setup

```bash
cp .env.example .env
```

Fill in database credentials and JWT secrets.

### 4. Initialize Database & Run

```bash
# Recreates DB, runs migrations, and seeds mock data
bun run app:dev

# Start development server
bun run dev
```

Swagger UI:
[http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

## 🏗️ Project Architecture & Nomenclature

To prevent complexity as the project grows, Bedest enforces strict structure:

* `S (Schema)` → Drizzle DB schemas (`SUser`, `STenant`)
* `V (Validation)` → TypeBox validation schemas (`VId`, `VQuery`)

```
src/
├── app/              # Router initialization, Dependency Injection
├── common/           # Shared utilities and base services
├── features/         # Domain modules (User, Tenant, Auth)
│   ├── user/
│   │   ├── enums/
│   │   ├── routers/
│   │   ├── schemas/      # DB tables (SUser.ts)
│   │   ├── services/     # Business logic
│   │   └── validations/  # Route typings
└── infrastructure/   # Error handling, DB, env validation
```

---

## 🛠️ Concepts & Usage

### 1. Multi-Tenancy & Smart Indexing (UtilDb)

```ts
export const SExample = pgTable("examples", {
  ...baseColumns,
  tenantId: uuid().references(() => STenant.id).notNull(),
  title: varchar({ length: 255 }).notNull(),
}, (t) => [
  UtilDb.activeIndex("idx_examples_active", t.id),
  UtilDb.tenantIsolationPolicy(t.tenantId),
]).enableRLS();
```

---

### 2. Generic CRUD (ServiceBase)

```ts
class ServiceExample extends ServiceBase<typeof SExample, string> {
  constructor() {
    super(SExample);
  }

  // Built-in:
  // create, update, remove, getById, getAll
}
```

All methods are:

* tenant-isolated
* paginated
* secure by default

---

### 3. Role-Based Access Control (RBAC)

```ts
export const RouterUser = new Elysia({ prefix: "/user" })
  .use(Context.User())
  .guard(
    {
      RoleGuard: [EUserRole.ADMIN, EUserRole.SYSTEM],
    },
    (app) =>
      app.get("/", async ({ query, userRuntime }) => {
        const res = await ServiceUser.getAll(userRuntime, query);
        return UtilRouter.defResponse(res);
      }, {
        query: VQuery,
      })
  );
```

---

### 4. Global Error Handling

```ts
if (!user) throw ErrorHandler.notFound("User doesn't exist");
if (pass !== user.password) throw ErrorHandler.validationError("Wrong password");
```

---

## 🐳 Docker & CI/CD

* Multi-stage Dockerfile (optimized image size)
* `docker-compose.yml` (app + PostgreSQL)
* GitHub Actions:

  * Lint + test (PGlite)
  * Build & push image to GHCR on merge

---

## 📜 Available Scripts

| Command               | Description                             |
| --------------------- | --------------------------------------- |
| `bun run dev`         | Start dev server with hot reload        |
| `bun run build`       | Build into single executable (`./dist`) |
| `bun run test`        | Run tests                               |
| `bun run check:files` | Type-check + ESLint                     |
| `bun run db:sync`     | Generate & apply migrations             |
| `bun run app:dev`     | Reset DB + migrate + seed               |

---
