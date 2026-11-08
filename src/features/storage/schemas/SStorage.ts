import { STenant } from "@f/tenant/schemas/STenant";
import { baseColumns, UtilDbSchema } from "bedest-core";
import { uuid, pgTable, varchar, integer } from "drizzle-orm/pg-core";
import { EStorageStatus, EStorageStatusPg } from "../enums/EStorageStatus";

export const SStorage = pgTable(
  "storage_files",
  {
    ...baseColumns,
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    name: varchar({ length: 255 }).notNull(),
    key: varchar({ length: 500 }).notNull().unique(),
    mimeType: varchar({ length: 100 }).notNull(),
    size: integer().notNull(),
    status: EStorageStatusPg().notNull().default(EStorageStatus.READY),
  },
  (t) => [
    UtilDbSchema.activeIndex("idx_storage_active", t.id),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
