import { VId } from "bedest-core";
import { t } from "elysia";

export const VDefault = {
  id: VId,
  createdBy: VId,
  isDeleted: t.Boolean(),
  createdAt: t.Date(),
  deletedAt: t.Date(),
};

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
  DATABASE_SSL: t.Optional(t.Boolean()),

  SECRET_KEY: t.String(),
  REFRESH_KEY: t.String(),

  PORT: t.Number(),

  LOCAL_STORAGE_PATH: t.Optional(t.String()),

  S3_ENDPOINT: t.Optional(t.String()),
  S3_REGION: t.Optional(t.String()),
  S3_ACCESS_KEY: t.Optional(t.String()),
  S3_SECRET_KEY: t.Optional(t.String()),
  S3_BUCKET: t.Optional(t.String()),

  REDIS_URL: t.Optional(t.String()),
});
