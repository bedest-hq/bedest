import { defineConfig } from "drizzle-kit";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required by drizzle-kit (see .env.example).`);
  }
  return value;
};

// Migrations run as the schema owner [SEC-04]. DATABASE_MIGRATION_* falls
// back to the runtime login for local development.
export default defineConfig({
  out: process.env.DATABASE_MIGRATION_DIR || "./drizzle",
  schema: ["./src/features/*/schemas/*", "./src/features/*/enums/*"],
  dialect: "postgresql",
  dbCredentials: {
    host: required("DATABASE_HOST"),
    port: Number(required("DATABASE_PORT")),
    database: required("DATABASE_NAME"),
    user: process.env.DATABASE_MIGRATION_USER ?? required("DATABASE_USER"),
    password:
      process.env.DATABASE_MIGRATION_PASSWORD ?? required("DATABASE_PASSWORD"),
    ssl: false, // For development
  },
});
