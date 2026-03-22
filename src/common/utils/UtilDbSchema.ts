import { sql } from "drizzle-orm";
import { index, PgColumn, pgPolicy, uniqueIndex } from "drizzle-orm/pg-core";

export class UtilDbSchema {
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
