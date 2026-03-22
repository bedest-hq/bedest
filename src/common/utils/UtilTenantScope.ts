import { ExtractTablesWithRelations, sql } from "drizzle-orm";
import { IUserApp } from "../interfaces/IContextApp";
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import { PgTransaction } from "drizzle-orm/pg-core";
import { TDb } from "../types/TDb";

type TTransaction =
  | NodePgDatabase
  | PgTransaction<
      NodePgQueryResultHKT,
      Record<string, never>,
      ExtractTablesWithRelations<Record<string, never>>
    >;

export class UtilTenantScope {
  static async tenantScope<T>(
    c: IUserApp,
    callback: (tx: TTransaction) => Promise<T>,
  ): Promise<T> {
    return await c.db.transaction(async (tx) => {
      const currentTenant = c.tenantId || "";
      await tx.execute(
        sql`SELECT set_config('app.current_tenant', ${currentTenant}, true), set_config('app.bypass_rls', 'off', true)`,
      );
      return callback(tx);
    });
  }

  static async systemScope<T>(
    db: TDb,
    callback: (tx: TTransaction) => Promise<T>,
  ): Promise<T> {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
      return callback(tx);
    });
  }
}
