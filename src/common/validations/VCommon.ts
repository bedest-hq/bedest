import { t } from "elysia";
// TypeBox Integer, not Elysia's t.Integer (a string|integer union that
// Value.Convert leaves as a string) [SEC-16][NEW-03].
import { Type } from "@sinclair/typebox";

export const VEnv = t.Object({
  // Required: no default, so a forgotten NODE_ENV can never mean "development".
  NODE_ENV: t.Union([
    t.Literal("development"),
    t.Literal("production"),
    t.Literal("test"),
  ]),
  // Comma-separated list of allowed browser origins (required in production).
  CORS_ORIGINS: t.Optional(t.String()),
  // DEPRECATED: use CORS_ORIGINS. Still read (with a warning) for one release.
  CORS_ORIGIN: t.Optional(t.String()),

  DATABASE_HOST: t.String(),
  DATABASE_PORT: t.Number(),

  DATABASE_NAME: t.String(),
  DATABASE_USER: t.String(),
  DATABASE_PASSWORD: t.String(),
  // Postgres TLS [SEC-15]: disable | require (TLS, no certificate check) |
  // verify-full. Default: verify-full in production, disable otherwise.
  DATABASE_SSL_MODE: t.Optional(
    t.Union([
      t.Literal("disable"),
      t.Literal("require"),
      t.Literal("verify-full"),
    ]),
  ),
  // CA certificate for verify-full: PEM content or a file path.
  DATABASE_SSL_CA: t.Optional(t.String({ minLength: 1 })),

  // At least 32 characters; must differ from REFRESH_KEY [SEC-16].
  SECRET_KEY: t.String({ minLength: 32 }),
  REFRESH_KEY: t.String({ minLength: 32 }),
  // JWT "iss" claim, set on sign and checked on verify [SEC-24].
  JWT_ISSUER: t.String({ minLength: 1, maxLength: 100, default: "bedest" }),

  PORT: t.Number(),
  // Largest accepted request body (default 10 MiB) [SEC-18]; must exceed
  // STORAGE_MAX_BYTES plus multipart overhead.
  MAX_REQUEST_BODY_BYTES: Type.Integer({
    minimum: 1024,
    default: 10 * 1024 * 1024,
  }),
  // pino level; default info (silent when NODE_ENV=test).
  LOG_LEVEL: t.Optional(
    t.Union([
      t.Literal("fatal"),
      t.Literal("error"),
      t.Literal("warn"),
      t.Literal("info"),
      t.Literal("debug"),
      t.Literal("trace"),
      t.Literal("silent"),
    ]),
  ),
  // Serve /api/docs in production too (always served in other modes).
  ENABLE_API_DOCS: t.Optional(t.Boolean()),
  // Hard deadline for the graceful shutdown before exiting with code 1.
  SHUTDOWN_TIMEOUT_MS: Type.Integer({ minimum: 1000, default: 15000 }),
  // Background jobs [FEAT-08]: off with JOBS_ENABLED=false (e.g. on extra
  // replicas; with several nodes an advisory lock keeps runs single).
  JOBS_ENABLED: t.Boolean({ default: true }),
  // Days a soft-deleted file is kept before its object is purged.
  STORAGE_PURGE_AFTER_DAYS: Type.Integer({ minimum: 1, default: 30 }),
  // Days a notification is kept before it is soft-deleted.
  NOTIFICATION_RETENTION_DAYS: Type.Integer({ minimum: 1, default: 180 }),

  LOCAL_STORAGE_PATH: t.Optional(t.String()),
  // Comma-separated MIME allowlist shared by direct and presigned uploads.
  STORAGE_ALLOWED_TYPES: t.String({
    minLength: 1,
    default: "image/jpeg,image/png,image/webp,application/pdf",
  }),
  // Maximum size of one stored file, in bytes (default 5 MiB).
  STORAGE_MAX_BYTES: Type.Integer({ minimum: 1, default: 5 * 1024 * 1024 }),

  S3_ENDPOINT: t.Optional(t.String()),
  S3_REGION: t.Optional(t.String()),
  S3_ACCESS_KEY: t.Optional(t.String()),
  S3_SECRET_KEY: t.Optional(t.String()),
  S3_BUCKET: t.Optional(t.String()),
  // Path-style URLs (endpoint/bucket/key); true for MinIO and most
  // S3-compatible stores, false (virtual-hosted) for AWS [BUG-18].
  S3_FORCE_PATH_STYLE: t.Boolean({ default: false }),

  REDIS_URL: t.Optional(t.String()),

  // Stripe webhook signing secret (whsec_...). When unset the billing
  // webhook route is not mounted at all.
  BILLING_WEBHOOK_SECRET: t.Optional(t.String({ minLength: 1 })),

  // Number of trusted reverse proxies in front of the app. 0 = ignore
  // X-Forwarded-For and use the socket address.
  TRUST_PROXY_HOPS: Type.Integer({ minimum: 0, maximum: 10, default: 0 }),
  // Login attempts per minute per (client IP + normalized e-mail).
  RATE_LIMIT_LOGIN_PER_MIN: Type.Integer({ minimum: 1, default: 5 }),
  // Login attempts per minute per client IP (any e-mail).
  RATE_LIMIT_LOGIN_IP_PER_MIN: Type.Integer({ minimum: 1, default: 20 }),
  // Token refreshes per minute per client IP.
  RATE_LIMIT_REFRESH_PER_MIN: Type.Integer({ minimum: 1, default: 30 }),
  // Public tenant resolutions (GET /public/resolve) per minute per client IP [SEC-25].
  RATE_LIMIT_TENANT_RESOLVE_PER_MIN: Type.Integer({ minimum: 1, default: 30 }),
});
