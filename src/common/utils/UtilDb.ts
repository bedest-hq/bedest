import { ExtractTablesWithRelations, sql } from "drizzle-orm";
import { IUserApp } from "../interfaces/IContextApp";
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import {
  index,
  PgColumn,
  pgPolicy,
  PgTransaction,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { TDb } from "../types/TDb";

type TTransaction =
  | NodePgDatabase
  | PgTransaction<
      NodePgQueryResultHKT,
      Record<string, never>,
      ExtractTablesWithRelations<Record<string, never>>
    >;

export class UtilDb {
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

  static tenantIsolationPolicy(tenantColumn: PgColumn) {
    return pgPolicy("tenant_isolation", {
      as: "permissive",
      for: "all",
      using: sql`
      current_setting('app.bypass_rls', true) = 'on'
      OR
      ${tenantColumn} = nullif(current_setting('app.current_tenant', true), '')::uuid
    `,
    });
  }

  static activeIndex(
    indexName: string,
    column: PgColumn,
    ...extraColumns: PgColumn[]
  ) {
    return index(indexName)
      .on(column, ...extraColumns)
      .where(sql`"isDeleted" = false`);
  }

  static activeUniqueIndex(
    indexName: string,
    column: PgColumn,
    ...extraColumns: PgColumn[]
  ) {
    return uniqueIndex(indexName)
      .on(column, ...extraColumns)
      .where(sql`"isDeleted" = false`);
  }
}
