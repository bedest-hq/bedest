## 🚀 What does this PR do?
[Explain the purpose of this PR. E.g., Added a new Redis cache service, fixed the RLS bypass bug in ServiceBaseTenant, etc.]

## 🔗 Related Issue
Fixes #

## 🛠 Type of Change
- [ ] 🐞 Bug Fix (non-breaking change which fixes an issue)
- [ ] ✨ New Feature (non-breaking change which adds functionality)
- [ ] ♻️ Refactoring (Code quality improvement, no new feature)
- [ ] 📖 Documentation Update

## 🏛️ Bedest Architecture Checklist (Critical)
- [ ] **Multi-tenancy:** If a new tenant-specific table was added, the service extends `ServiceBaseTenant` instead of `ServiceBase`.
- [ ] **Transaction & Context:** Database operations are wrapped in the correct scope (`UtilTenantScope.tenantScope` or `UtilTenantScope.systemScope`) and properly utilize the `IUserApp` / `IApp` contexts.
- [ ] **Strict Typing:** No `any` types were used. Type Narrowing is used for `unknown` errors. Drizzle's `InferInsertModel` and `InferSelectModel` are utilized correctly.
- [ ] **Schema Standards:** `UtilDbSchema.activeIndex` and `UtilDbSchema.tenantIsolationPolicy` are included for new tables where applicable.
- [ ] **Security & Guards:** Elysia routes are correctly protected using `RoleGuard` or `PlanGuard` macros where required.

## 🧪 Testing
- [ ] Ran `bun test` and all existing PGlite tests passed successfully.
- [ ] Added new test cases for the specific feature or bug fix.

## 📋 Extra Checks
- [ ] Code follows the existing formatting and linting rules (e.g., all `if` statements use curly braces `{}`).
- [ ] Updated `.env.example` and `VEnv` in `VCommon.ts` with any new environment variables required.
