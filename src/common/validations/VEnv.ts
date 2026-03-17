import { t } from "elysia";

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
