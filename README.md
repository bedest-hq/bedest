<p align="center">
  <img src="docs/images/bedest.png" alt="Bedest Logo" width="200" />
</p>

<h1 align="center">Bedest - B.E.D. Stack Boilerplate</h1>

<p align="center">
  <strong>A high-performance, strictly typed backend boilerplate built for scale.</strong><br>
  Powered by <b>B</b>un, <b>E</b>lysiaJS, and <b>D</b>rizzle ORM.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
</p>

---

**Bedest** is not just another starter template; it is a robust, production-ready foundation for SaaS applications and scalable microservices. By enforcing a **Feature-Based Architecture**, it eliminates spaghetti code and provides built-in solutions for authentication, multi-tenancy, standardized responses, and error handling. 

Stop wrestling with setup and focus on shipping your business logic.

## ✨ Features

- ⚡️ **Blazing Fast**: Runs on the ultra-fast Bun runtime and ElysiaJS.
- 🛡️ **End-to-End Type Safety**: From database schemas (Drizzle) to API routes (TypeBox) and Environment variables (Zod).
- 🏗️ **Feature-Based Architecture**: Domains are isolated in `src/features`, making scaling and refactoring a breeze.
- 🔐 **Production-Ready Auth**: Dual-Token architecture (JWT Access + Refresh Tokens) with DB-backed session management and role-based access control (RBAC).
- 🏢 **Multi-Tenancy Auto-Filtering**: Built-in abstraction (`ServiceBase`) dynamically applies `tenantId` and `isDeleted` filters to queries.
- 📚 **Auto-Generated Docs**: Swagger/OpenAPI documentation is instantly available.

## 🚀 Quick Start

### 1. Prerequisites
- [Bun](https://bun.sh/) (v1.0+)
- PostgreSQL Database

### 2. Installation
```bash
git clone git@github.com:barisatay0/bedest.git my-app
cd my-app
bun install

```

### 3. Environment Setup

```bash
cp .env.example .env

```

*Configure your PostgreSQL credentials and JWT secrets in the `.env` file.*

### 4. Database Initialization & Run

Bedest includes custom scripts to handle migrations and seeding seamlessly:

```bash
# Drops DB, recreates, runs migrations, and seeds mock data
bun run app:dev

# Start the development server
bun run dev

```

🎉 Your API is now running at `http://localhost:3000`.
Explore the Swagger UI at `http://localhost:3000/api/docs`.

---

## 🏗️ Architecture & Core Concepts

Bedest moves away from the traditional MVC layer structure. Everything related to a specific domain (e.g., Users) lives together.

```text
src/
├── app/              # App initialization, Router, Context Injection
├── common/           # Shared utilities (UtilRouter), validation schemas (SId, SEmail)
├── features/         # 📦 The heart of your app (Domain Modules)
│   ├── base/         # Abstract Generic CRUD Services (ServiceBase)
│   ├── user/         # User domain (tables, services, routers)
│   └── [feature]/    # Create your own domains here!
└── infrastructure/   # Error handling, DB pools, Env validation

```

### 🧠 The Context Pattern (Dependency Injection)

Instead of importing DB instances everywhere, Bedest passes a strictly typed `Context` into every route using Elysia's `.derive()` pattern. `userRuntime` contains the active DB instance, request time, and the user's session (`userId`, `role`, `tenantId`).

---

## 🛠️ Step-by-Step Examples

Bedest is packed with utilities like `ServiceBase`, `UtilRouter`, and `ErrorHandler` to keep your code DRY and type-safe.

### 1. Multi-Tenancy & Global Filters (`ServiceBase`)

`ServiceBase` automatically detects if your table has a `tenantId` column. If it does, it **forces** tenant isolation for every `create`, `get`, `update`, and `remove` operation using the active session's `tenantId`.

**Table Definitions (`TbTask.ts`):**

```typescript
import { uuid, pgTable, varchar, timestamp, boolean } from "drizzle-orm/pg-core";

// EXAMPLE A: Global Table (No Tenant ID)
export const TbGlobalCategory = pgTable("global_categories", {
  id: uuid().defaultRandom().primaryKey(),
  isDeleted: boolean().default(false).notNull(), // Required by ServiceBase
  createdAt: timestamp({ withTimezone: true }).notNull(), // Required by ServiceBase
  name: varchar({ length: 255 }).notNull(),
});

// EXAMPLE B: Tenant-Isolated Table
export const TbTask = pgTable("tasks", {
  id: uuid().defaultRandom().primaryKey(),
  tenantId: uuid(), // Automatically handled by ServiceBase!
  isDeleted: boolean().default(false).notNull(), 
  createdAt: timestamp({ withTimezone: true }).notNull(),
  title: varchar({ length: 255 }).notNull(),
});

```

**Service Layer (`ServiceTask.ts`):**

```typescript
import { TbTask } from "../tables/TbTask";
import { ServiceBase } from "../../base/services/ServiceBase";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

class ServiceTask extends ServiceBase<typeof TbTask, string> {
  constructor() {
    super(TbTask);
  }
  
  // Custom business logic utilizing ErrorHandler
  async markAsUrgent(c: IUserApp, id: string) {
    // getById automatically filters by tenantId and isDeleted = false!
    const task = await this.getById(c, id, { id: TbTask.id });
    
    if (!task) {
      throw ErrorHandler.notFound("Task not found or does not belong to your tenant.");
    }
    
    if (c.session.role === "GUEST") {
      throw ErrorHandler.forbidden("Guests cannot mark tasks as urgent.");
    }

    await this.update(c, id, { title: "URGENT Task" });
  }
}

export default new ServiceTask();

```

### 2. Standardizing API Responses (`UtilRouter`)

`UtilRouter` forces you to strictly type both your route definitions (for Swagger) and your actual returned data. This prevents leaking sensitive database columns to the client.

**Router Layer (`RouterTask.ts`):**

```typescript
import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import ServiceTask from "../services/ServiceTask";
import { UtilRouter } from "@/common/utils/UtilRouter";
import { SId, SString } from "@/common/validations";

export const RouterTask = new Elysia({ prefix: "/tasks", tags: ["Tasks"] })
  .use(Context.User()) // Protect route & inject context
  .get("/:id", async ({ params, userRuntime }) => {
      // 1. Fetch data
      const res = await ServiceTask.getById(userRuntime, params.id, { 
        id: TbTask.id, 
        title: TbTask.title 
      });
      
      // 2. Return data wrapped in UtilRouter
      return UtilRouter.defResponse(res);
  }, {
      // 3. Define params and strictly validate the response schema for Swagger
      params: t.Object({ id: SId }),
      response: UtilRouter.defSchema(
        t.Object({
          id: SId,
          title: SString,
        })
      )
  });

```

## 🚨 Error Handling Architecture

Never throw standard `Error()` objects. The centralized `ErrorHandler` automatically parses exceptions and formats consistent HTTP JSON responses.

Available methods include:

* `ErrorHandler.badRequest()` (400)
* `ErrorHandler.unauthorized()` (401)
* `ErrorHandler.forbidden()` (403)
* `ErrorHandler.notFound()` (404)
* `ErrorHandler.alreadyExists()` (409)

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
