import { PgColumn } from "drizzle-orm/pg-core";

export interface IBaseTable {
  id: PgColumn;
  createdAt: PgColumn;
  isDeleted: PgColumn;
  deletedAt: PgColumn;
  tenantId?: PgColumn;
}
