import { STenant } from "@f/tenant/schemas/STenant";
import { baseColumns, UtilDbSchema } from "bedest-core";
import { uuid, pgTable, varchar, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    // Uploader (users.id); null for files uploaded before SEC-26. No FK:
    // users already reference storage_files (avatarId).
    uploadedBy: uuid(),
  },
  (t) => [
    UtilDbSchema.activeIndex("idx_storage_active", t.id),
    // Tenant file list, newest first [PERF-01].
    index("idx_storage_tenant_created")
      .on(t.tenantId, t.createdAt.desc().nullsFirst())
      .where(sql`${t.isDeleted} = false`),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
