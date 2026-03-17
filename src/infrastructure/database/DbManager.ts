import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { TEnv } from "@/common/types/TEnv";

class DbManager {
  private db: NodePgDatabase | undefined;
  private pool: pg.Pool | undefined;

  async recreate(env: TEnv) {
    const client = new pg.Client({
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      ssl: false,
    });
    await client.connect();
    await client.query(`
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = '${env.DATABASE_NAME}'
      AND pid <> pg_backend_pid();
  `);
    await client.query(`DROP DATABASE IF EXISTS ${env.DATABASE_NAME}`);
    await client.query(`CREATE DATABASE ${env.DATABASE_NAME}`);
    await client.end();
  }

  init(env: TEnv) {
    this.pool = new pg.Pool({
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME,
      ssl: false,
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
