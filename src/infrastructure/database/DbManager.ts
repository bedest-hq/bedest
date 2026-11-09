import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { TEnv } from "@/common/types/TEnv";
import { sql } from "drizzle-orm";
import { TDb } from "bedest-core";
import { UtilDbSsl } from "./UtilDbSsl";
import { tryAdvisoryLock, type TJobLock } from "../jobs/JobScheduler";

class DbManager {
  private db: NodePgDatabase | undefined;
  private pool: pg.Pool | undefined;

  init(env: TEnv) {
    this.pool = new pg.Pool({
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME,
      ssl: UtilDbSsl.options(env),
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
      ssl: UtilDbSsl.options(env),
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

  /**
   * Use an existing handle (tests, embedding) instead of opening a pool
   * with init() [QLT-01].
   */
  use(db: TDb) {
    this.db = db;
  }

  get() {
    if (!this.db) {
      throw new Error("Database is not inited yet.");
    }
    return this.db;
  }

  /**
   * Job lock [FEAT-08]: pg_try_advisory_lock on a connection taken from the
   * pool for the duration of the job (session locks belong to one
   * connection), unlocked and returned to the pool by the release.
   */
  jobLock: TJobLock = async (name) => {
    if (!this.pool) {
      throw new Error("Database is not inited yet.");
    }
    const client = await this.pool.connect();
    try {
      const release = await tryAdvisoryLock(
        (text, params) => client.query(text, params),
        name,
      );
      if (!release) {
        client.release();
        return null;
      }
      return async () => {
        try {
          await release();
        } finally {
          client.release();
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  };

  async shutdown() {
    await this.pool?.end();
  }
}

export default new DbManager();
