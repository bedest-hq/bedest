import pg from "pg";
import { TEnv } from "@/common/types/TEnv";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilDbSsl } from "@/infrastructure/database/UtilDbSsl";
import { UtilScriptDb } from "./UtilScriptDb";
import { UtilReset, VResetEnv } from "../UtilReset";

/**
 * Drops and re-creates DATABASE_NAME as the schema owner
 * (DATABASE_MIGRATION_*). Lives in the script, never in the runtime
 * DbManager [OPS-09].
 */
export async function recreateDatabase(env: TEnv) {
  if (!/^[a-zA-Z0-9_-]+$/.test(env.DATABASE_NAME)) {
    throw new Error("Invalid database name");
  }

  const client = new pg.Client({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    ...UtilScriptDb.ownerCredentials(env),
    database: "postgres",
    ssl: UtilDbSsl.options(env),
  });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [env.DATABASE_NAME],
    );
    const safeDbName = `"${env.DATABASE_NAME.replace(/"/g, '""')}"`;
    await client.query(`DROP DATABASE IF EXISTS ${safeDbName}`);
    await client.query(`CREATE DATABASE ${safeDbName}`);
  } finally {
    await client.end();
  }
}

/**
 * Refuses in production and without confirmation, then recreates the
 * database. Failures reject (the CLI exits 1) [OPS-09].
 *
 *   bun run src/scripts/database/DatabaseReset.ts --yes
 *   CONFIRM_RESET=<DATABASE_NAME> bun run db:reset
 */
export async function runDatabaseReset(opts: {
  env: TEnv;
  argv: readonly string[];
  confirm?: string;
  recreate?: (env: TEnv) => Promise<void>;
}) {
  UtilReset.assertAllowed(opts.env, opts.argv, opts.confirm);
  await (opts.recreate ?? recreateDatabase)(opts.env);
}

if (import.meta.main) {
  await UtilReset.runMain("Database reset", async () => {
    const env = EnvManager.init();
    const { CONFIRM_RESET } = EnvManager.parseScript(VResetEnv);
    await runDatabaseReset({
      env,
      argv: process.argv.slice(2),
      confirm: CONFIRM_RESET,
    });
    process.stdout.write(`Database ${env.DATABASE_NAME} re-created.\n`);
  });
}
