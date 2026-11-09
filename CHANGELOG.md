# Changelog

## Unreleased

Remediation release: security, correctness, operations and the missing account features. IDs refer to the remediation ledger.

### ⚠ Breaking changes

* **Environment.** `NODE_ENV` is required (no default) [SEC-02]; values are type-checked and every problem is reported at once [SEC-16]; `SECRET_KEY`/`REFRESH_KEY` need ≥ 32 characters, must differ and cannot be the `.env.example` placeholders in production. `CORS_ORIGINS` replaces `CORS_ORIGIN` (still read with a warning) [SEC-18]; `DATABASE_SSL_MODE` replaces `DATABASE_SSL` and defaults to `verify-full` in production [SEC-15]. New required `MAIL_PROVIDER` and `APP_PUBLIC_URL` [FEAT-06].
* **Database roles.** The API must connect as a member of `bedest_app` (`ProvisionRoles`); migrations run as the schema owner (`DATABASE_MIGRATION_*`) [SEC-04]; RLS is forced on every tenant table. Production refuses to start as a superuser or BYPASSRLS role.
* **Auth.** No credential fallbacks [SEC-01]; `POST /auth/refresh` returns `{ success: true }` only [SEC-14]; the refresh cookie is `Path=/api/v1/auth; SameSite=Strict` and tokens carry `iss`/`aud`/`typ` — users sign in once after the deploy [SEC-24]. New passwords need 12–128 characters [SEC-23].
* **Errors.** Every error body is `{ error, message?, details?, requestId? }` [BUG-14].
* **Audit.** Routes configure `audit: { entity, action?, targetTenant? }` (no `audit: true`) [BUG-11]; audit rows are append-only [FEAT-13].
* **Storage.** Only the uploader or an ADMIN deletes a file; 409 while it is in use [SEC-26]. Avatars and logos must be READY files of the same tenant [SEC-27]; uploads follow `STORAGE_ALLOWED_TYPES`/`STORAGE_MAX_BYTES` and presigned uploads stay PENDING until `POST /storage/:id/complete` [SEC-10][FEAT-12]; `IProvider` requires `head()` [FEAT-12].
* **Tenants.** `POST /tenant` returns `{ id }` and invites the ADMIN by e-mail [SEC-23][FEAT-06]; `DELETE /tenant/:id` also soft-deletes the tenant's users [FEAT-09]; plan checks answer `403 PLAN_UPGRADE_REQUIRED` instead of `426` [CORE-07].
* **Users.** `GET /user` items carry `status` (`ACTIVE`/`INVITED`) [FEAT-06].
* **bedest-core 2.0** (unpublished at the time of writing; see its changelog).

### Security

* Login fallbacks to seeded credentials removed; seed requires `SEED_SYSTEM_EMAIL` and generates a password when none is given [SEC-01][SEC-03].
* Row-level security enforced: non-privileged runtime role, forced RLS, every query scoped [SEC-04][BUG-01]; billing webhook verifies Stripe signatures and processes each event once [SEC-05][BUG-07]; presigned uploads cannot store active content and files are served with nosniff/CSP [SEC-10]; `x-tenant-id` removed [SEC-19]; users of deleted tenants lose access [SEC-22]; tenant resolution is rate limited [SEC-25]; cross-tenant file references refused [SEC-27].
* Audit payloads scrubbed of secrets; `RedactAuditLogs` cleans existing rows [SEC-06].
* Rate limits scoped to their routes, keyed on the real client IP (`TRUST_PROXY_HOPS`), configurable [SEC-07].
* Revoked, deleted or demoted principals lose access at the next request; refresh rotation is atomic with reuse detection [SEC-08][SEC-09].
* Role policy: ADMINs can no longer take over or delete peers or SYSTEM users; no self-lockout [SEC-11][SEC-12][SEC-13].
* TLS verification for Postgres, API docs off in production, security headers, body limit, CORS list, WebSocket origin check and CSRF origin check [SEC-15][SEC-17][SEC-18].
* Logger keeps errors and redacts secrets [SEC-20]; e-mails validated and normalized, unique case-insensitively [SEC-21].
* Account lockout after 5 failures in 15 minutes and security-event auditing [FEAT-07].

### Fixes

* Empty updates → 400 [BUG-02]; storage write/delete ordering no longer loses data or leaks objects [BUG-03]; presign on the local provider answers 501 [BUG-04]; read receipts are unique [BUG-05].
* Logout disconnects only the current device [BUG-06]; maintenance mode is shared through Redis and cached [BUG-08]; Redis reconnects forever with backoff [BUG-09].
* WebSocket registry keyed per connection; sockets close when their token expires or session ends [BUG-10].
* Seed and context fixes [BUG-12]; validations fixed and bounded to column sizes [BUG-13][QLT-11]; tenant authorization in one place and tenant creation atomic [BUG-15][BUG-16].
* S3 downloads stream, report backend errors (502) and support path-style or virtual-hosted URLs [BUG-18].

### Features

* Health endpoints `/api/health/live` and `/api/health/ready` [FEAT-01]; migration runner `db:migrate:prod` [FEAT-02][OPS-01]; graceful shutdown [FEAT-03][OPS-08].
* Request ids (`x-request-id`) and one access-log line per request [FEAT-04].
* Session management: list, revoke one, log out everywhere [FEAT-05].
* Password reset and invitations by e-mail (`MAIL_PROVIDER` console/smtp) [FEAT-06].
* Background jobs with an advisory lock (`JOBS_ENABLED`) [FEAT-08].
* Tenant restore (`POST /tenant/:id/restore`) [FEAT-09]; presigned upload finalization [FEAT-12].
* Append-only audit logs (grants + trigger) [FEAT-13].
* Cursor pagination for the audit log and notifications [PERF-02]; indexes for RLS predicates and list ordering [PERF-01].

### Operations and quality

* Dockerfile, compose (provision → migrate → api), CI (frozen lockfile, check, format, drift check, coverage) and CD fixed [OPS-02]–[OPS-06]; destructive scripts guarded [OPS-09]; version metadata from `package.json` [OPS-10].
* No import-time side effects (`createApp(env)`) [QLT-01]; no `any`/`eslint-disable`/needless casts [QLT-03][QLT-04]; dead code removed [QLT-05]; type-only client in `client/` [QLT-06]; Prettier wired [QLT-09].
* Tests: USER is the default test principal, unique fixtures per test, coverage gate ≥ 80 % lines on `src/features` and `src/infrastructure` [TST-01]–[TST-06].
* README rewritten (environment table, security model, deployment, upgrading) [DOC-01].

### Notes

* **Version metadata [OPS-10].** `bedest.json` no longer carries a `version`; the development update check reads it from `package.json`, the only file release-please bumps. The released sections below are left as they were published (the 1.1.0 → 1.2.0 history mixed the two values).

### Required one-off steps for existing deployments

* **Redact plaintext secrets already stored in audit logs [SEC-06].** Older versions stored fields such as `currentPassword` unredacted in `system_audit_logs.payload`. After upgrading run `bun run src/scripts/audit/RedactAuditLogs.ts` (dry run, reports the number of affected rows) and then `bun run src/scripts/audit/RedactAuditLogs.ts --apply` (rewrites them in batches of 500). Rotate any password that may have been exposed.

## [1.2.0](https://github.com/bedest-hq/bedest/compare/v1.1.0...v1.2.0) (2026-10-10)


### Features

* comprehensive security hardening, multi-tenant isolation, redis clustering, and saas features ([#82](https://github.com/bedest-hq/bedest/issues/82)) ([36565c3](https://github.com/bedest-hq/bedest/commit/36565c39af3cc81fd8c9a850d6784e8301695f22))
* new tenant fields implemented. ([#73](https://github.com/bedest-hq/bedest/issues/73)) ([99b282c](https://github.com/bedest-hq/bedest/commit/99b282cdf24165d7f30bbd546fbc547f151c6909))
* users gonna know when updates come to bedest ([#79](https://github.com/bedest-hq/bedest/issues/79)) ([774f83d](https://github.com/bedest-hq/bedest/commit/774f83dfdbb46dd3389184f03b10f824f22080f8))


### Bug Fixes

* little implementations for easier frontend implementations ([#72](https://github.com/bedest-hq/bedest/issues/72)) ([086ebdf](https://github.com/bedest-hq/bedest/commit/086ebdf2118492786f0400dfd0c141d461a1ddf3))
* phone field removed from router maybe we can add again. ([#70](https://github.com/bedest-hq/bedest/issues/70)) ([d346798](https://github.com/bedest-hq/bedest/commit/d34679892b8cf73d4b8ea1fb0fd08b332af8b6c1))

## [1.1.0](https://github.com/bedest-hq/bedest/compare/v1.0.4...v1.1.0) (2026-06-01)


### Features

* add storage feature with local and S3 providers ([#43](https://github.com/bedest-hq/bedest/issues/43)) ([ba8da67](https://github.com/bedest-hq/bedest/commit/ba8da6754bdca3d5c812fe4fc910b849c41fba78))
* for guests public resolve is implemented and some buggies fixed. ([#51](https://github.com/bedest-hq/bedest/issues/51)) ([660dcf1](https://github.com/bedest-hq/bedest/commit/660dcf1aa37d010d5a62e03c48ed4a67c0578e56))
* for self getter we added id field ([#62](https://github.com/bedest-hq/bedest/issues/62)) ([96434f0](https://github.com/bedest-hq/bedest/commit/96434f0fd336d80f83358296f62b41da2d1870d8))
* local storage clean script is implemented service base ordered with datetime and minor problems fixed. ([#59](https://github.com/bedest-hq/bedest/issues/59)) ([7f1b9f8](https://github.com/bedest-hq/bedest/commit/7f1b9f87285a6beacb26a7cfdac69dd3ae9aab46))


### Bug Fixes

* service base tenant context changed from IUserApp to ITenanApp. ([#48](https://github.com/bedest-hq/bedest/issues/48)) ([0907903](https://github.com/bedest-hq/bedest/commit/09079031bbebc19d1c6214510004ce5a0fe4a135))

## [1.0.4](https://github.com/bedest-hq/bedest/compare/v1.0.3...v1.0.4) (2026-03-31)


### Bug Fixes

* some routers was became lean. ([#31](https://github.com/bedest-hq/bedest/issues/31)) ([5e00152](https://github.com/bedest-hq/bedest/commit/5e0015295aafea4106bbfdbd660e13013dd60e47))

## [1.0.3](https://github.com/bedest-hq/bedest/compare/v1.0.2...v1.0.3) (2026-03-25)


### Bug Fixes

* missing maintenance mode is implemented. ([#29](https://github.com/bedest-hq/bedest/issues/29)) ([9236436](https://github.com/bedest-hq/bedest/commit/9236436801533252c59be0a0a3825df8877816be))

## [1.0.2](https://github.com/bedest-hq/bedest/compare/v1.0.1...v1.0.2) (2026-03-25)


### Bug Fixes

* forgotten tenant plan guard implementation. ([#27](https://github.com/bedest-hq/bedest/issues/27)) ([83f70c5](https://github.com/bedest-hq/bedest/commit/83f70c503258cfe342ddcf1e3fa8254a12a57af8))

## [1.0.1](https://github.com/bedest-hq/bedest/compare/v1.0.0...v1.0.1) (2026-03-23)


### Bug Fixes

* unnecessary router util functions removed and cleaned from routers. ([#23](https://github.com/bedest-hq/bedest/issues/23)) ([ba518f1](https://github.com/bedest-hq/bedest/commit/ba518f1c1cc6b291c3cb80b525c54ce72210d0d0))
