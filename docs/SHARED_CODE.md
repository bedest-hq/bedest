# Shared code between bedest and bedest-lite

`bedest` (multi-tenant SaaS) and `bedest-lite` (single organization) are separate templates that copy most of their infrastructure from each other. Drift between the copies has caused real bugs (SEC-11: a fix that existed in one template only). This document lists what is duplicated and proposes how to share it. **Nothing here is implemented yet**: extracting code into a package is out of scope of the remediation (QLT-02); until then every change to a module below must be made in both templates (see the parity table in the remediation ledger).

Measured on branch `fix/review-remediation` (non-test `src/**/*.ts`): 72 files exist in both templates; 36 are byte-identical, 36 differ.

## 1. Identical in both templates

| Area | Files |
| --- | --- |
| HTTP plumbing | `app/Shutdown.ts`, `app/Swagger.ts`, `app/plugins/PluginBodyLimit.ts`, `PluginCsrf.ts`, `PluginSecurityHeaders.ts`, `UtilOrigin.ts`, `infrastructure/error/ErrorHandler.ts`, `common/utils/UtilHttp.ts`, `common/types/IApiError.ts` |
| Auth | `features/auth/routers/RouterAuth.ts`, `auth/utils/UtilAuth.ts`, `auth/validations/VPassword.ts`, `session/utils/UtilSessionCache.ts`, `session/schemas/SRevokedRefreshToken.ts` |
| Users | `user/enums/EUserRole.ts`, `user/utils/UtilEmail.ts`, `user/validations/VUserRole.ts`, `VUserInput.ts` |
| Storage | `storage/enums/EStorageStatus.ts`, `storage/validations/VStorageInput.ts`, `infrastructure/storage/providers/ProviderLocal.ts` |
| System | `system/routers/RouterSystem.ts`, `system/schemas/SSystemSetting.ts`, `health/services/ServiceHealth.ts` |
| Infrastructure | `database/UtilDbSsl.ts`, `env/UtilEnv.ts`, `logger/logger.ts`, `ratelimit/UtilClientIp.ts`, `common/types/TEnv.ts` |
| Scripts | `scripts/UtilReset.ts`, `database/DatabaseReset.ts`, `Migrate.ts`, `ProvisionRoles.ts`, `UtilScriptDb.ts`, `seed/UtilSeedPassword.ts`, `storage/StorageReset.ts` |

## 2. Same module, template-specific differences

| Difference | Files (lines differing) |
| --- | --- |
| Tenant id in tokens, sessions, rows (RLS) | `auth/validations/VJwtPayload.ts` (1), `session/schemas/SSession.ts` (8), `user/schemas/SUser.ts` (7), `storage/schemas/SStorage.ts` (14), `system/schemas/SSystemLog.ts` (14), `notification/schemas/SNotification.ts` (41), `app/Context.ts` (9), `user/utils/UtilUserPolicy.ts` (8) |
| RLS scopes (`tenantScope` / `systemScope`) vs plain queries | `session/services/ServiceSession.ts` (157), `storage/services/ServiceStorage.ts` (182), `system/services/ServiceSystemLog.ts` (200), `notification/services/ServiceNotification.ts` (241), `user/services/ServiceUser.ts` (111), `auth/services/ServiceAuth.ts` (61), `scripts/seed/seed.ts` (76), `scripts/audit/RedactAuditLogs.ts` (10) |
| Redis (SAAS only) | `infrastructure/websocket/WsManager.ts` (70), `ratelimit/RateLimitManager.ts` (65), `system/services/ServiceSystem.ts` (12), `health/routers/RouterHealth.ts` (9), `index.ts` (12) |
| Presigned URLs, hardened file headers (SAAS only) | `infrastructure/storage/StorageManager.ts` (54), `providers/ProviderS3.ts` (33), `interfaces/IProvider.ts` (7), `storage/utils/UtilStorage.ts` (95), `storage/routers/RouterStorage.ts` (46) |
| Environment, routes, wiring | `common/validations/VCommon.ts` (20), `env/EnvManager.ts` (7), `app/Router.ts` (18), `database/DbManager.ts` (6), `common/constants.ts` (3), `update/UpdateChecker.ts` (2), `system/plugins/PluginAudit.ts` (39), `user/routers/RouterUser.ts` (11), `notification/routers/RouterNotification.ts` (2), `system/routers/RouterSystemLog.ts` (2) |

## 3. Proposal (not implemented)

1. **Move tenant-agnostic infrastructure into `bedest-core`** (or a sibling package `bedest-server`, if core should stay free of runtime dependencies such as pino or the AWS SDK): error envelope (`UtilHttp`, `IApiError`, `ErrorHandler`), security plugins (CSRF, security headers, body limit, origin check), `UtilClientIp`, `UtilDbSsl`, `UtilEnv`, the logger factory, graceful shutdown, reset/migrate/provision scripts, `ProviderLocal`, `UtilSessionCache`, password/e-mail validators. These are byte-identical today, so extraction is mechanical.
2. **Parameterize what differs only by tenancy.** Most differences in section 2 are "with `tenantId` + RLS scope" vs "without". A package could export factories taking a `scope` strategy (`tenantScope`/`systemScope` vs direct handle) and schema builders taking an optional tenant column — the same split `ServiceBase`/`ServiceBaseTenant` already uses in `bedest-core`.
3. **Keep Redis and presigned storage as optional adapters** (interfaces in the package, implementations selected by env), so bedest-lite uses the in-memory/no-presign variants instead of a copy without them.
4. **Migrate in small steps**: extract one module at a time, publish, switch both templates to the import, delete the copies, and keep a contract test in the package. Database schemas and migrations stay in the templates (they own their migration history).
5. **Until then**: keep the parity table up to date and treat a change to any file listed here as a change to both templates.
