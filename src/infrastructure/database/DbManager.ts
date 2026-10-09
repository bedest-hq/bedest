import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { TEnv } from "@/common/types/TEnv";

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
