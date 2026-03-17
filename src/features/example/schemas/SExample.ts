import { UtilDb } from "@/common/utils/UtilDb";
import { baseColumns } from "@/common/schemas/SBase";
import { STenant } from "@f/tenant/schemas/STenant";
import { uuid, pgTable, varchar } from "drizzle-orm/pg-core";

export const SExample = pgTable(
  "examples",
  {
    ...baseColumns,
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    exampleColumn: varchar({ length: 255 }).notNull(),
    otherExampleColumn: varchar({ length: 255 }).notNull().unique(),
  },
  (t) => [
    UtilDb.activeIndex("idx_examples_active", t.id),
    UtilDb.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
