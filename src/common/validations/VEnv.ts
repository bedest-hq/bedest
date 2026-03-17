import { z } from "zod";

export const VEnv = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_HOST: z.string(),
  DATABASE_PORT: z.string().transform(Number),
  DATABASE_NAME: z.string(),
  DATABASE_USER: z.string(),
  DATABASE_PASSWORD: z.string(),

  SECRET_KEY: z.string(),
  REFRESH_KEY: z.string(),

  PORT: z.string().transform(Number),
});
