<p align="center">
  <img src="docs/images/bedest.png" alt="Bedest Logo" width="200" />
</p>

# Bedest - B.E.D. Stack Boilerplate

**Bedest** is a high-performance, strictly typed backend boilerplate built on the B.E.D. stack (**B**un, **E**lysia, **D**rizzle). It is designed to serve as a robust foundation for scalable SaaS applications and microservices, enforcing a modular, feature-based architecture.

This project provides a pre-configured environment with production-ready authentication, database management, and error handling, allowing developers to focus on business logic rather than infrastructure setup.

## Technology Stack

- **Runtime:** [Bun](https://bun.sh/) - A fast all-in-one JavaScript runtime.
- **Framework:** [ElysiaJS](https://elysiajs.com/) - A high-performance, type-safe web framework.
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/) - A lightweight, type-safe SQL ORM.
- **Database:** PostgreSQL.
- **Validation:** TypeBox (via Elysia) and Zod (for Environment variables).
- **Documentation:** Swagger/OpenAPI (Auto-generated).

## Project Architecture

Bedest moves away from the traditional Layered Architecture (Controllers/Services/Models folders) in favor of a **Feature-Based Architecture**. Each logical domain of the application is self-contained within the `src/features` directory.

### Directory Structure

```text
src/
├── app/                  # Application core configuration
│   ├── Context.ts        # Dependency injection and request context (User, DB, Session)
│   ├── Router.ts         # Main entry point for route aggregation
│   └── Swagger.ts        # OpenAPI documentation configuration
├── common/               # Shared resources across features
│   ├── constants.ts      # Global constants
│   ├── interfaces/       # Global interfaces (IContextApp, etc.)
│   ├── schemas/          # Reusable validation schemas (SId, SEmail, etc.)
│   └── types/            # Global Types (TDb, TEnv)
├── features/             # Business Logic Modules
│   ├── auth/             # Authentication logic (Login, Logout, Refresh)
│   ├── base/             # Abstract base services for CRUD and Multi-tenancy
│   ├── session/          # Session management logic
│   ├── user/             # User management domain
│   └── [feature_name]/   # Scalable pattern for new features
│       ├── enums/
│       ├── routers/
│       ├── services/
│       └── tables/
├── infrastructure/       # Low-level infrastructure implementations
│   ├── db/               # Database connection and migration managers
│   ├── env/              # Environment variable validation and parsing
│   └── error/            # Centralized error handling logic
└── scripts/              # Automation scripts (DB Reset, Seeding, Context Building)
```
## Key Concepts & Design Patterns

### 1. The Context Pattern
Bedest utilizes Elysia’s `derive` pattern to inject a strictly typed context into every request.
- **`IApp`**: Contains the database instance (`db`) and the request timestamp (`nowDatetime`).
- **`IUserApp`**: Extends `IApp` to include the authenticated user's session (`session`), containing `userId`, `role`, and `tenantId`.

This ensures that services do not need to instantiate their own dependencies; they are passed down from the Router.

### 2. Service Abstraction & Multi-Tenancy
To reduce boilerplate code for CRUD operations, Bedest implements a generic service layer located in `src/features/base`.

- **`ServiceBase`**: Provides standard `create`, `get`, `getById`, `update`, and `remove` methods for any Drizzle table.
- **`ServiceTenant`**: Extends `ServiceBase` but enforces **Multi-Tenancy** constraints. It automatically injects the `tenantId` from the request context into creation queries and filters by `tenantId` for read/update operations.

### 3. Authentication Flow
The system uses a Dual-Token architecture (Access Token + Refresh Token) with database-backed sessions.
1.  **Login**: Returns an HTTP-Only Refresh Token and a short-lived Access Token. Creates a session record in the database.
2.  **Access**: The Access Token payload contains `userId` and `role`.
3.  **Refresh**: Verifies the Refresh Token against the database session to issue new Access Tokens.
4.  **Logout**: Invalidates the session in the database and clears cookies.

### 4. Database Management
The project uses `drizzle-kit` for migrations. The `DbManager` class in infrastructure handles connection pooling and graceful shutdowns.

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (latest version)
- PostgreSQL Database

### Installation

1.  **Clone the repository:**
    ```bash
    git clone git@github.com:barisatay0/bedest.git
    cd bedest
    ```

2.  **Install dependencies:**
    ```bash
    bun install
    ```

3.  **Environment Setup:**
    Copy the example environment file and configure your database credentials.
    ```bash
    cp .env.example .env
    ```
    *Update `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, and `DATABASE_NAME` in `.env`.*

### Database Initialization

Bedest includes comprehensive scripts to handle the database lifecycle.

1.  **Full Reset & Migration (Development):**
    This command drops the database, recreates it, runs migrations, and seeds mock data.
    ```bash
    bun run app:dev
    ```

2.  **Manual Migration Commands:**
    - `bun run db:gen`: Generate SQL migrations from Drizzle schema.
    - `bun run db:mig`: Apply migrations to the database.
    - `bun run db:re`: Drop and recreate the database (Schema reset).

### Running the Application

- **Development Mode:**
    ```bash
    bun run dev
    ```
    The server will start at `http://localhost:3000`. Swagger documentation is available at `http://localhost:3000/api/docs`.

- **Production Build:**
    ```bash
    bun run build
    bun run start
    ```

## Extending the Project

To add a new feature (e.g., "Product"):

1.  **Create Directory:** `src/features/product`
2.  **Define Schema:** Create `tables/TbProduct.ts`. Ensure it imports `uuid` and includes `tenantId` if it is tenant-specific.
3.  **Create Service:** Create `services/ServiceProduct.ts`. Extend `ServiceTenant` for automatic tenant isolation.
4.  **Create Router:** Create `routers/RouterProduct.ts`. Use `Context.User()` to access the authenticated context.
5.  **Register:** Add the router to `src/app/Router.ts`.
6.  **Migrate:** Run `bun run db:gen` and `bun run db:mig`.

## Error Handling

Errors are managed centrally via the `ErrorHandler` class (`src/infrastructure/error/ErrorHandler.ts`). Do not throw generic JavaScript errors; instead, use the static methods provided:

```typescript
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

if (!record) {
    throw ErrorHandler.notFound("Record not found");
}
```

## License

This project is licensed under the [MIT License](LICENSE).
