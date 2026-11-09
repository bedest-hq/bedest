import { defineConfig } from "drizzle-kit";
import {
  UtilDbSsl,
  type TDbSslMode,
} from "./src/infrastructure/database/UtilDbSsl";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required by drizzle-kit (see .env.example).`);
  }
  return value;
};

const SSL_MODES: readonly TDbSslMode[] = ["disable", "require", "verify-full"];
const sslMode = SSL_MODES.find((m) => m === process.env.DATABASE_SSL_MODE);
if (process.env.DATABASE_SSL_MODE && !sslMode) {
  throw new Error("DATABASE_SSL_MODE must be disable, require or verify-full.");
}

// Migrations run as the schema owner [SEC-04]. DATABASE_MIGRATION_* falls
// back to the runtime login for local development. TLS uses the same rules
// as the application [SEC-15].
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
    ssl: UtilDbSsl.options({
      NODE_ENV:
        process.env.NODE_ENV === "production" ? "production" : "development",
      DATABASE_SSL_MODE: sslMode,
      DATABASE_SSL_CA: process.env.DATABASE_SSL_CA,
    }),
  },
});
