import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { TEnv } from "@/common/types/TEnv";
import { sql } from "drizzle-orm";
import { TDb } from "bedest-core";

class DbManager {
  private db: NodePgDatabase | undefined;
  private pool: pg.Pool | undefined;

  async recreate(env: TEnv) {
    if (!/^[a-zA-Z0-9_-]+$/.test(env.DATABASE_NAME)) {
      throw new Error("Invalid database name");
    }

    const client = new pg.Client({
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: "postgres",
      ssl:
        env.NODE_ENV === "production" || env.DATABASE_SSL === true
          ? { rejectUnauthorized: false }
          : false,
    });
    await client.connect();
    await client.query(
      `
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = $1
      AND pid <> pg_backend_pid();
  `,
      [env.DATABASE_NAME],
    );
    const safeDbName = `"${env.DATABASE_NAME.replace(/"/g, '""')}"`;
    await client.query(`DROP DATABASE IF EXISTS ${safeDbName}`);
    await client.query(`CREATE DATABASE ${safeDbName}`);
    await client.end();
  }

  init(env: TEnv) {
    this.pool = new pg.Pool({
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME,
      ssl:
        env.NODE_ENV === "production" || env.DATABASE_SSL === true
          ? { rejectUnauthorized: false }
          : false,
    });

    this.db = drizzle(this.pool);
  }

  /**
   * A separate pool with other credentials (e.g. the schema owner for
   * migrations and maintenance scripts). The caller must `end()` it.
   */
  connect(env: TEnv, credentials: { user: string; password: string }) {
    const pool = new pg.Pool({
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: credentials.user,
      password: credentials.password,
      database: env.DATABASE_NAME,
      ssl:
        env.NODE_ENV === "production" || env.DATABASE_SSL === true
          ? { rejectUnauthorized: false }
          : false,
    });
    return { db: drizzle(pool), end: () => pool.end() };
  }

  /**
   * Startup guard [SEC-04]: superusers and BYPASSRLS roles ignore row-level
   * security. Refuses to start in production; returns a warning otherwise.
   */
  async verifyRuntimeRole(
    db: TDb,
    nodeEnv: TEnv["NODE_ENV"],
  ): Promise<string | null> {
    const res = await db.execute(
      sql`SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const row: unknown = res.rows[0];
    const privileged =
      typeof row === "object" &&
      row !== null &&
      "rolsuper" in row &&
      "rolbypassrls" in row &&
      (row.rolsuper === true || row.rolbypassrls === true);
    if (!privileged) {
      return null;
    }
    const role =
      typeof row === "object" && row !== null && "role" in row
        ? String(row.role)
        : "unknown";
    const message = `Database role "${role}" is a superuser or has BYPASSRLS: row-level security is NOT enforced. Connect as a member of bedest_app (see README "Database roles & RLS").`;
    if (nodeEnv === "production") {
      throw new Error(message);
    }
    return message;
  }

  get() {
    if (!this.db) {
      throw new Error("Database is not inited yet.");
    }
    return this.db;
  }

  async shutdown() {
    await this.pool?.end();
  }
}

export default new DbManager();
