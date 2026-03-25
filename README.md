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
  <img src="https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white" alt="GitHub Actions">
</p>

---

Building a scalable B2B SaaS requires solving complex architectural challenges like Multi-tenancy, Row-Level Security (RLS), Role-Based Access Control (RBAC), and deployment pipelines from day one.

**Bedest** is designed to skip the grueling setup phase. It enforces a strict Domain-Driven Design (DDD), provides built-in tenant isolation at the database level, and handles standard CRUD & Pagination automatically. 

Stop wrestling with configurations and focus on shipping your business logic.

---

## Core Features

- ** Blazing Fast**: Built on top of the Bun runtime and ElysiaJS, delivering microsecond response times.
- ** True Multi-Tenancy**: PostgreSQL Row-Level Security (RLS) guarantees data isolation. Tenant filtering is automated via `UtilTenantScope`.
- ** Generic Service Pattern**: `ServiceBaseTenant` handles CRUD operations and automatic metadata pagination out of the box.
- ** End-to-End Type Safety**: Drizzle for DB, TypeBox for routing, and generic strict types. **Zero `any` allowed.**
- ** Enterprise Auth & RBAC**: Dual-token JWT (Access + Refresh) stored in HTTP-only cookies, protected by a custom Elysia `RoleGuard` macro.
- ** Lightning Fast Tests**: Instant, isolated database tests running in-memory with **PGlite**. No more mock data headaches.
- ** CI/CD Ready**: Multi-stage Docker builds, GitHub Actions for automated testing/linting, and automatic image pushes to GHCR.

---

## Quick Start

### Prerequisites
- [Bun](https://bun.sh/) (v1.0+)
- PostgreSQL (Local or via Docker)

### Local Development Setup

1. **Create or Clone  the repository:**

```bash
bun create barisatay0/bedest my-app
cd my-app
bun i
```
or 

```bash
git clone git@github.com:barisatay0/bedest.git my-app
cd my-app
bun install
````

2. **Environment Variables:**

```bash
cp .env.example .env
```

Update your `.env` with your local PostgreSQL credentials and JWT secrets.

3. **Database Initialization & Seeding:**

```bash
# Generates schema, migrates, and seeds mock data
bun run app:dev
```

4. **Start the Engine:**

```bash
bun run dev
```

Swagger UI: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

## Docker Deployment Setup

Bedest comes with a production-ready docker-compose.yml and a highly optimized multi-stage Dockerfile.

```bash
# Start the application and the PostgreSQL database in detached mode
docker-compose up -d
```

---

## Architecture & Nomenclature

To prevent spaghetti code as your project grows, Bedest enforces a strict modular structure.

### Strict Naming Conventions

* S → Database Schemas (e.g., SUser, STenant)
* V → Validation Objects (e.g., VId, VQuery, VString)
* E → Enums (e.g., EUserRole)

### Folder Structure

```plaintext
src/
├── app/              # Router initialization, Dependency Injection & Context
├── common/           # Shared utilities, base services, and generic schemas
├── features/         # Domain modules (Bounded Contexts)
│   ├── auth/
│   ├── user/
│   │   ├── enums/
│   │   ├── routers/      # API Endpoints (Elysia)
│   │   ├── schemas/      # DB Tables (Drizzle)
│   │   └── services/     # Business Logic
│   └── tenant/
└── infrastructure/   # DB Manager, Env Validation, Global Error Handler
```

---

## Core Concepts (The Secret Sauce)

### 1. Multi-Tenancy & Smart Indexing

Bedest uses PostgreSQL Row-Level Security (RLS) to ensure tenants can never access each other's data. You define policies directly in your schema using UtilDbSchema.

```ts
export const SExample = pgTable("examples", {
  ...baseColumns, // id, isDeleted, createdAt, deletedAt
  tenantId: uuid().references(() => STenant.id).notNull(),
  title: varchar({ length: 255 }).notNull(),
}, (t) => [
  UtilDbSchema.activeIndex("idx_examples_active", t.id),
  UtilDbSchema.tenantIsolationPolicy(t.tenantId),
]).enableRLS();
```

---

### 2. Generic CRUD & Automated Pagination

Why write SELECT * FROM table LIMIT 10 for every new feature? ServiceBaseTenant handles everything automatically, including formatting the output for modern frontends.

```ts
class ServiceExample extends ServiceBaseTenant<typeof SExample, string> {
  constructor() { super(SExample); }
}

// In your router:
const data = await ServiceExample.getAll(userRuntime, query, { title: SExample.title });
```

**API Output:**

```json
{
  "data": [
    { "title": "Example 1" }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### 3. Role-Based Access Control (RBAC) via Macros

Bedest extends Elysia with a custom `.guard` macro called RoleGuard. Protecting an endpoint takes exactly one line of code:

```ts
export const RouterUser = new Elysia({ prefix: "/user" })
  .use(Context.User())
  .guard(
    {
      RoleGuard: [EUserRole.ADMIN, EUserRole.SYSTEM], // 🔒 Only Admins and System
    },
    (app) => app.delete("/:id", async ({ params, userRuntime }) => {
        return ServiceUser.remove(userRuntime, params.id);
    })
  );
```

---

### 4. Bulletproof Context Injection

We don't pass req or res objects around. Instead, Elysia resolves the JWT, identifies the User and Tenant, and passes a strictly typed IUserApp context to the service layer.

```ts
export interface IUserApp {
  db: NodePgDatabase;
  nowDatetime: Date;
  tenantId: string;
  session: {
    userId: string;
    sessionId: string;
    role: EUserRole;
  };
}
```

---

## Testing with PGlite

Testing database logic is usually slow and painful. Bedest utilizes PGlite to spin up an ephemeral, in-memory PostgreSQL instance for your tests.

Run tests in milliseconds, safely mutating database state without affecting your real development database.

```bash
bun test
```

---

## CI/CD & Dependabot

Your infrastructure is automated:

* **Dependabot**: Automatically scans and opens PRs for npm, docker, and github-actions updates every Monday.
* **CI Pipeline**: On every Pull Request, GitHub Actions checks typings, lints the code, and runs PGlite unit tests.
* **CD Pipeline**: On merge to main, the app is built and pushed to the GitHub Container Registry (GHCR) as a lightweight Docker image.

---

## Available Scripts

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| bun run dev         | Start development server with hot reload |
| bun run check:files | Run TypeScript type-check and ESLint     |
| bun run test        | Run isolated unit & integration tests    |
| bun run db:gen      | Generate Drizzle SQL migrations          |
| bun run db:push     | Push schema changes to the database      |
| bun run app:dev     | Reset DB, migrate, and seed mock data    |
| bun run build       | Build into a production-ready output     |

---

## Contributing

We welcome contributions! Please refer to the `.github/pull_request_template.md` and `.github/ISSUE_TEMPLATE` guidelines.

Ensure all tests pass (`bun test`) and no TypeScript errors exist (`bun run check:files`) before submitting a PR.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.
