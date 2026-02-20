import { UtilDb } from "@/common/utils/UtilDb";
import { baseColumns } from "@f/base/tables/TbBase";
import { TbTenant } from "@f/tenant/tables/TbTenant";
import { uuid, pgTable, varchar, index } from "drizzle-orm/pg-core";

export const TbExample = pgTable(
  "examples",
  {
    ...baseColumns,
    tenantId: uuid()
      .references(() => TbTenant.id)
      .notNull(),
    exampleColumn: varchar({ length: 255 }).notNull(),
    otherExampleColumn: varchar({ length: 255 }).notNull().unique(),
  },
  (t) => [
    index().on(t.id, t.isDeleted),
    UtilDb.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
