## 🚀 What Does This PR Do?

<!-- Explain the purpose clearly. E.g., "Added cursor-based pagination to ServiceBase," "Fixed RLS bypass bug in UtilTenantScope," "Extracted X to bedest-core." -->

---

## 🔗 Related Issue

Fixes #

---

## 🛠 Type of Change

- [ ] 🐞 Bug Fix (non-breaking change which fixes an issue)
- [ ] ✨ New Feature (non-breaking change which adds functionality)
- [ ] ♻️ Refactoring (code quality improvement, no new feature)
- [ ] 💥 Breaking Change (fix or feature that would cause existing functionality to change)
- [ ] 📦 bedest-core (change that belongs to or affects the shared core package)
- [ ] 📖 Documentation Update

---

## 🏛️ Bedest Architecture Checklist

**Multi-tenancy & RLS**
- [ ] New tenant-specific tables have their service extending `ServiceBaseTenant` (not `ServiceBase`).
- [ ] New tables include `UtilDbSchema.tenantIsolationPolicy` and `.enableRLS()`.
- [ ] No raw DB query bypasses `UtilTenantScope.tenantScope` or `UtilTenantScope.systemScope`.

**Context & Typing**
- [ ] Service methods follow the `(c: IUserApp, ...)` or `(c: IApp, ...)` context pattern.
- [ ] No `any` types introduced. `unknown` errors are handled via type narrowing.
- [ ] Drizzle `InferInsertModel` / `InferSelectModel` are used correctly where applicable.

**Security & Guards**
- [ ] New routes are protected with `RoleGuard` or `PlanGuard` macros where required.
- [ ] No sensitive data (passwords, tokens) is logged or returned in responses.

**bedest-core boundary**
- [ ] Generic, domain-agnostic logic goes into `bedest-core`. Domain-specific logic stays in this repo.
- [ ] If `bedest-core` was changed, the version is bumped and the dependency here is updated.

---

## 🧪 Testing

- [ ] `bun test` passes with all existing PGlite tests green.
- [ ] New test cases added for the feature or bug fix.
- [ ] Edge cases covered: 404 for missing records, 403 for cross-tenant access, 401 for unauthenticated requests.

---

## 📋 Extra Checks

- [ ] Code follows existing formatting and linting rules (`bun run check` passes).
- [ ] `.env.example` and `VEnv` in `VCommon.ts` updated if new environment variables were added.
- [ ] No `console.log` left in production paths — use the `logger` from `infrastructure/logger`.
