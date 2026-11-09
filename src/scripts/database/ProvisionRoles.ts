import { sql } from "drizzle-orm";
import { t } from "elysia";
import { TDb } from "bedest-core";
import EnvManager from "@/infrastructure/env/EnvManager";
import DbManager from "@/infrastructure/database/DbManager";

/**
 * Operator script [SEC-04]: run once per environment with superuser
 * credentials to create the group role `bedest_app` and the application's
 * LOGIN role (DATABASE_USER / DATABASE_PASSWORD) as a member of it.
 * Idempotent: re-running updates the password and membership.
 *
 *   DATABASE_ADMIN_USER=postgres DATABASE_ADMIN_PASSWORD=... \
 *     bun run src/scripts/database/ProvisionRoles.ts
 */
export const VProvisionEnv = t.Object({
  DATABASE_ADMIN_USER: t.String({ minLength: 1 }),
  DATABASE_ADMIN_PASSWORD: t.String(),
});

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const rowsOf = (res: { rows: unknown[] }) => res.rows;

const formatted = async (db: TDb, query: ReturnType<typeof sql>) => {
  const [row] = rowsOf(await db.execute(query));
  if (typeof row !== "object" || row === null || !("stmt" in row)) {
    throw new Error("Failed to build the role statement.");
  }
  return String(row.stmt);
};

export async function provisionRoles(
  db: TDb,
  opts: {
    loginRole: string;
    loginPassword: string;
    print: (l: string) => void;
  },
) {
  if (!IDENTIFIER_RE.test(opts.loginRole)) {
    throw new Error(`Invalid role name: ${JSON.stringify(opts.loginRole)}`);
  }

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bedest_app') THEN
        CREATE ROLE bedest_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $$;
  `);

  const exists =
    rowsOf(
      await db.execute(
        sql`SELECT 1 FROM pg_roles WHERE rolname = ${opts.loginRole}`,
      ),
    ).length > 0;

  // The server quotes the identifier (%I) and the password literal (%L).
  const template = exists
    ? "ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT PASSWORD %L"
    : "CREATE ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT PASSWORD %L";
  await db.execute(
    sql.raw(
      await formatted(
        db,
        sql`SELECT format(${template}, ${opts.loginRole}::text, ${opts.loginPassword}::text) AS stmt`,
      ),
    ),
  );
  await db.execute(
    sql.raw(
      await formatted(
        db,
        sql`SELECT format('GRANT bedest_app TO %I', ${opts.loginRole}::text) AS stmt`,
      ),
    ),
  );

  opts.print(
    `${exists ? "Updated" : "Created"} login role "${opts.loginRole}" (member of bedest_app).`,
  );
}

async function main() {
  const env = EnvManager.init();
  const admin = EnvManager.parseScript(VProvisionEnv);
  const conn = DbManager.connect(env, {
    user: admin.DATABASE_ADMIN_USER,
    password: admin.DATABASE_ADMIN_PASSWORD,
  });
  try {
    await provisionRoles(conn.db, {
      loginRole: env.DATABASE_USER,
      loginPassword: env.DATABASE_PASSWORD,
      print: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await conn.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(
      `ProvisionRoles failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
