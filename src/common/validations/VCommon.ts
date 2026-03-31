import { t } from "elysia";

export const VId = t.String({ format: "uuid" });

export const VDefault = {
  id: VId,
  createdBy: VId,
  isDeleted: t.Boolean(),
  createdAt: t.Date(),
  deletedAt: t.Date(),
};

export const VEmail = t.String({ format: "email" });

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
});

export const VNumber = t.Number({ minimum: 0 });

export const VString = t.String({ minLength: 1 });

export const VQuery = t.Object({
  limit: t.Numeric({ default: 20, minimum: 1, maximum: 100 }),
  page: t.Numeric({ default: 1, minimum: 1 }),
});
