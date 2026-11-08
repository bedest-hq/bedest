import { migrate } from "drizzle-orm/node-postgres/migrator";
import { TDb } from "bedest-core";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilScriptDb, VMigrationEnv } from "./UtilScriptDb";

/**
 * Runtime migration runner [OPS-01][FEAT-02]: applies the committed SQL
 * migrations without drizzle-kit (a devDependency absent from production
 * images). Runs as the schema owner (DATABASE_MIGRATION_*).
 *
 *   bun run db:migrate:prod          # from source
 *   bun dist/migrate.js              # inside the production image
 */
export async function runMigrations(db: TDb, migrationsFolder: string) {
  await migrate(db, { migrationsFolder });
}

async function main() {
  const env = EnvManager.init();
  const { DATABASE_MIGRATION_DIR } = EnvManager.parseScript(VMigrationEnv);
  const owner = UtilScriptDb.openOwner(env);
  try {
    await runMigrations(owner.db, DATABASE_MIGRATION_DIR);
    process.stdout.write(`Migrations from ${DATABASE_MIGRATION_DIR} applied.\n`);
  } finally {
    await owner.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(
      `Migration failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
