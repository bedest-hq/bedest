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

## [2.0.0](https://github.com/bedest-hq/bedest/compare/v1.2.0...v2.0.0) (2026-11-10)


### ⚠ BREAKING CHANGES

* **auth:** tokens issued before this change lack the new claims, so every user has to log in again once after the deploy.

### Features

* **app:** graceful shutdown on SIGTERM/SIGINT [OPS-08][FEAT-03] ([6cac6d1](https://github.com/bedest-hq/bedest/commit/6cac6d1233b6d7e2eed16ce9414e6a5cd0fdc53a))
* **audit:** append-only audit log trigger [FEAT-13] ([6073d17](https://github.com/bedest-hq/bedest/commit/6073d173310477d084a3bdef1df92d8b4c27da77))
* **auth:** account lockout and security-event audit [FEAT-07] ([da0d9a1](https://github.com/bedest-hq/bedest/commit/da0d9a1d499176aee9024d197e350d5fe11a02ea))
* **auth:** password reset and invitations by e-mail [FEAT-06] [SEC-23] ([7a257df](https://github.com/bedest-hq/bedest/commit/7a257df834ed8ad238c0b720aa5bc3141f0e83dc))
* **auth:** session management [FEAT-05] ([744f226](https://github.com/bedest-hq/bedest/commit/744f2267dda5ee4c9ef283a0c90e4c75aa6a6958))
* **db:** add a runtime migration runner [OPS-01][FEAT-02] ([df2b25b](https://github.com/bedest-hq/bedest/commit/df2b25b6dc34dbf55149671350ff16a622b6999e))
* **health:** add liveness and readiness endpoints [FEAT-01] ([ae645fa](https://github.com/bedest-hq/bedest/commit/ae645fa4dda692e2bf2eee80e3a73aa13652f609))
* **jobs:** background job scheduler with advisory locks [FEAT-08][FEAT-03] ([de3f488](https://github.com/bedest-hq/bedest/commit/de3f48884b0f33a00a496f273d2748b0f8705ed4))
* **observability:** request ids and access logs [FEAT-04] ([c7f0b2c](https://github.com/bedest-hq/bedest/commit/c7f0b2ce13bc80f0f8e4f1f4edbe2c018d44f0af))
* **storage:** finalize presigned uploads [FEAT-12] ([5b6a2f3](https://github.com/bedest-hq/bedest/commit/5b6a2f3d4919d8d9d3c164f715df58a05ed7fd81))
* **tenant:** tenant delete and restore lifecycle [FEAT-09] ([cc71994](https://github.com/bedest-hq/bedest/commit/cc71994c78186cae859bd7334b034a6f07f1df38))


### Bug Fixes

* **audit:** configured entity, nullable entityId, typed hooks [BUG-11][QLT-03] ([6bf2e74](https://github.com/bedest-hq/bedest/commit/6bf2e748ca7a366a1a27e20dd4218309095191a7))
* **audit:** consume normalized-key scrubber and add RedactAuditLogs [SEC-06] ([de4ab70](https://github.com/bedest-hq/bedest/commit/de4ab701179de388992650a1e54b9991a038509f))
* **auth:** 12-128 character policy for new passwords [SEC-23] ([836e959](https://github.com/bedest-hq/bedest/commit/836e95959a312f80ab9b4ec50dabeac4c4eb2c8e))
* **auth:** logout disconnects only the current session [BUG-06] ([5a7d693](https://github.com/bedest-hq/bedest/commit/5a7d6931221f13349acef778f3e6d5deaf5350d2))
* **auth:** remove default-credential login fallback [SEC-01] ([c8fe2c3](https://github.com/bedest-hq/bedest/commit/c8fe2c3dbbceb6e1cbc79a925daed8c10e9d2a5a))
* **auth:** revoke sessions and re-read principals from the database [SEC-08] ([07b9f8a](https://github.com/bedest-hq/bedest/commit/07b9f8aaf99eeac55129846f20b3b7903cc32d7c))
* **auth:** rotate refresh sessions atomically and detect token reuse [SEC-09] ([c2c70e6](https://github.com/bedest-hq/bedest/commit/c2c70e6a4c67e568cde9af7540106a8fe3540647))
* **auth:** scope rate limits per route and stop refunding failed logins [SEC-07] ([86ca7a8](https://github.com/bedest-hq/bedest/commit/86ca7a829769f70f47a3149120b37a8024b97688))
* **auth:** scope the refresh cookie and bind tokens to iss/aud/typ [SEC-24] ([24d6f60](https://github.com/bedest-hq/bedest/commit/24d6f60404c324a72c4d0499added84c53e6a730))
* **auth:** stop returning the access token from /auth/refresh [SEC-14] ([4cf61d6](https://github.com/bedest-hq/bedest/commit/4cf61d6a9d5822f7c938a07c3c986c0d60c495f2))
* **billing:** one typed handler per Stripe event [BUG-07] ([c5fe1e2](https://github.com/bedest-hq/bedest/commit/c5fe1e2897bd496ae5f0d5424d1f3b16b3eae974))
* **billing:** verify Stripe signatures over the raw body, idempotently [SEC-05] ([ae40c65](https://github.com/bedest-hq/bedest/commit/ae40c6514ac5d24093b34fb9031268bf0d1b87c2))
* **ci:** inherit PATH in child process tests and disable JSC IPInt in CI ([8344230](https://github.com/bedest-hq/bedest/commit/8344230a4f2900c2c9dac350cbaddb73633b798c))
* **ci:** pin Bun 1.3.14 to resolve WASM memory table bounds and flush access log tests ([a33eebe](https://github.com/bedest-hq/bedest/commit/a33eebeefc37bac96dcb649338a5468de87afc1a))
* **compose:** production-grade stack with roles, migrations and Redis [OPS-03] ([841aaa7](https://github.com/bedest-hq/bedest/commit/841aaa7a094cc2d3dd5cc9a38f820879cca7ccb0))
* **context:** remove the unvalidated, unused x-tenant-id context [SEC-19] ([19ab6d1](https://github.com/bedest-hq/bedest/commit/19ab6d1ceb59c406830c20bf705d40be5bf9ae5b))
* **db:** enforce row-level security with a non-privileged app role [SEC-04] ([bf26040](https://github.com/bedest-hq/bedest/commit/bf260404b0a8f40fa6b6d626780c9793332dd358))
* **db:** verify Postgres TLS certificates by default in production [SEC-15] ([07991ec](https://github.com/bedest-hq/bedest/commit/07991ec7dc441f9cf39e804c58066f30f8fd7b3e))
* **docker:** reproducible, non-root image with committed migrations [OPS-02][OPS-01] ([0beb7a4](https://github.com/bedest-hq/bedest/commit/0beb7a4ab8daa363a68ae4574fce5aecc9921911))
* **docs:** hide API docs in production and migrate to @elysiajs/openapi [SEC-17] ([e2a38e7](https://github.com/bedest-hq/bedest/commit/e2a38e7556a01604cd275a0e0604a4c61370b52d))
* **env:** report every env error, enforce secret rules, coerce integers [SEC-16] ([c709aa3](https://github.com/bedest-hq/bedest/commit/c709aa31d1b1ee2623893729e4544aeecd7a75fb))
* **env:** require NODE_ENV and explicit production CORS origins [SEC-02] ([fffdc6b](https://github.com/bedest-hq/bedest/commit/fffdc6bab3772668b03d5612e4326f52f5c4c1f5))
* **errors:** one error envelope for every failure [BUG-14] ([f9cd6bb](https://github.com/bedest-hq/bedest/commit/f9cd6bbdddeea5302c572028cb39bab48bed3603))
* **http:** security headers, body limit, CSRF and WebSocket origin checks [SEC-18] ([e91000a](https://github.com/bedest-hq/bedest/commit/e91000a04ef38d886fe0fd9c18c98201d586f7f1))
* **jobs:** type the injected lock in the scheduler test [FEAT-08] ([27f1c73](https://github.com/bedest-hq/bedest/commit/27f1c73634cf22b9a5047cbcd81faaaad204a896))
* **logger:** keep error details and redact secrets in logs [SEC-20] ([135365d](https://github.com/bedest-hq/bedest/commit/135365dad650d6db6b221b15bdae17fe5bc56f2a))
* **notification:** one read receipt per user and notification [BUG-05] ([f13b23b](https://github.com/bedest-hq/bedest/commit/f13b23b6611208788beeb2e163dcc2242c54494f))
* **plan:** adopt 403 PLAN_UPGRADE_REQUIRED from bedest-core [CORE-07] ([4b126e2](https://github.com/bedest-hq/bedest/commit/4b126e288814602b520cc706d492e7d88a025e38))
* **redis:** recover from outages and restore subscriptions [BUG-09] ([2082ac1](https://github.com/bedest-hq/bedest/commit/2082ac14025b6eac94e949ea58029cfa893d38ca))
* **scripts:** guard destructive resets and fail loudly [OPS-09] ([277eaa1](https://github.com/bedest-hq/bedest/commit/277eaa13475ceba0226a1bbf988c54acfd2762b0))
* **scripts:** remove ContextBuilder and its fake system context [BUG-12] ([a032864](https://github.com/bedest-hq/bedest/commit/a0328646ac139005bd23d21a6145fff249f72bbe))
* **seed:** remove hardcoded superuser password and e-mail [SEC-03] ([499e7c4](https://github.com/bedest-hq/bedest/commit/499e7c4af0c3506627041664aa682bd5e2f27a6b))
* **service:** empty update payloads are a uniform 400 [BUG-02] ([e46df20](https://github.com/bedest-hq/bedest/commit/e46df207c5bc793fc9a2179398d4ce85e2737db0))
* **storage:** close stored XSS through presigned uploads and inline view [SEC-10] ([f051274](https://github.com/bedest-hq/bedest/commit/f051274d17b15671be5c3e14f82dff9a5b396b81))
* **storage:** logos and avatars must be READY files of the same tenant [SEC-27] ([3ce5c44](https://github.com/bedest-hq/bedest/commit/3ce5c44ecd25dff0f261cda53ea35aadedadc11d))
* **storage:** only the uploader or an admin may delete a file [SEC-26] ([63c5e27](https://github.com/bedest-hq/bedest/commit/63c5e27ea618e2588b1bd840f8c230808dc431ed))
* **storage:** presign without provider support is 501, not a fake URL [BUG-04] ([e8d5cd7](https://github.com/bedest-hq/bedest/commit/e8d5cd7cff552c6ebf65dcc94a1641dd382917e4))
* **storage:** stream S3 downloads, surface backend errors, configurable path style [BUG-18] ([a3470a5](https://github.com/bedest-hq/bedest/commit/a3470a537a6d352c956c08dd6a3d2ffef62e9641))
* **storage:** write the row before the object and never delete eagerly [BUG-03] ([9ab73e0](https://github.com/bedest-hq/bedest/commit/9ab73e08c4139df723316d77b17c040d13cedb2e))
* **system:** keep maintenance mode in the database, shared by every node [BUG-08] ([5b1224c](https://github.com/bedest-hq/bedest/commit/5b1224c9508ab5a1329d7533ac08fc6779619e49))
* **tenant:** authorization only in ServiceTenant, no body mutation [BUG-15] ([eb7d687](https://github.com/bedest-hq/bedest/commit/eb7d68720df74b612a4100c20692dcadd66529d5))
* **tenant:** create the tenant and its admin atomically [BUG-16] ([c305cfa](https://github.com/bedest-hq/bedest/commit/c305cfa36ff066660565f0896665c5e23c873eaf))
* **tenant:** run tenant CRUD and system events inside RLS scopes [BUG-01] ([d0b3a50](https://github.com/bedest-hq/bedest/commit/d0b3a50b70e668f40c4215422209031129b28055))
* **tenant:** throttle and validate public tenant resolution [SEC-25] ([33aa975](https://github.com/bedest-hq/bedest/commit/33aa975cfc1f36542d93eb328d779f9d28e6ab51))
* **update:** read the template version from package.json [OPS-10] ([6906735](https://github.com/bedest-hq/bedest/commit/690673526fa59393813eaf8052c84e4e0f9c1ca5))
* **user:** one role policy for create, update and remove [SEC-12] ([a2caba1](https://github.com/bedest-hq/bedest/commit/a2caba111b160597c7e12bb378ab64b9c5fc2f90))
* **user:** prevent self-lockout and orphaned tenants [SEC-13] ([bd2185d](https://github.com/bedest-hq/bedest/commit/bd2185d64880ec0dff0a440f2d99e8d128e069f9))
* **user:** validate and normalize e-mail addresses [SEC-21] ([4356692](https://github.com/bedest-hq/bedest/commit/43566921675dcccefe60d4268cc8ccd2f97270f6))
* **validation:** bound request strings by their column sizes [QLT-11] ([8ff860f](https://github.com/bedest-hq/bedest/commit/8ff860f53ac6d1a2fe8f48a4f88fa58b155c040c))
* **validation:** one schema per enum, drop VDefault [BUG-13] ([9b4a1d0](https://github.com/bedest-hq/bedest/commit/9b4a1d06e1cf5c22d8fbbcaf71ddece5ea268fad))
* **ws:** one registry keyed by connection id, close sockets on token expiry [BUG-10] ([bd35682](https://github.com/bedest-hq/bedest/commit/bd35682b95f847dd6d81f83950471083789eae96))


### Performance Improvements

* **api:** optional cursor pagination for the audit log and notifications [PERF-02] ([8538397](https://github.com/bedest-hq/bedest/commit/8538397257fc189bfd973e1eebb8c7a5ff65986d))
* **db:** indexes for RLS predicates and newest-first lists [PERF-01] ([fd99b1a](https://github.com/bedest-hq/bedest/commit/fd99b1a53d8ee4aff09784534bb3c9b3342779a4))

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
