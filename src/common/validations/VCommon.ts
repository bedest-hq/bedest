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
  NODE_ENV: t.Union(
    [t.Literal("development"), t.Literal("production"), t.Literal("test")],
    { default: "development" },
  ),
  CORS_ORIGIN: t.String({ default: "http://localhost:3000" }),

  DATABASE_HOST: t.String(),
  DATABASE_PORT: t.Number(),

  DATABASE_NAME: t.String(),
  DATABASE_USER: t.String(),
  DATABASE_PASSWORD: t.String(),

  SECRET_KEY: t.String(),
  REFRESH_KEY: t.String(),

  PORT: t.Number(),

  LOCAL_STORAGE_PATH: t.Optional(t.String()),

  S3_ENDPOINT: t.Optional(t.String()),
  S3_REGION: t.Optional(t.String()),
  S3_ACCESS_KEY: t.Optional(t.String()),
  S3_SECRET_KEY: t.Optional(t.String()),
  S3_BUCKET: t.Optional(t.String()),
});
