import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: process.env.DATABASE_MIGRATION_DIR || "./drizzle",
  schema: ["./src/features/*/tables/*", "./src/features/*/enums/*"],
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.DATABASE_HOST!,
    port: parseInt(process.env.DATABASE_PORT!),
    database: process.env.DATABASE_NAME!,
    user: process.env.DATABASE_USER!,
    password: process.env.DATABASE_PASSWORD!,
    ssl: false, // For development
  },
});
