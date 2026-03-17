import { uuid, pgTable, varchar } from "drizzle-orm/pg-core";
import { EUserRolePg } from "../enums/EUserRole";
import { STenant } from "@f/tenant/schemas/STenant";
import { UtilDb } from "@/common/utils/UtilDb";
import { baseColumns } from "@/common/schemas/SBase";

export const SUser = pgTable(
  "users",
  {
    ...baseColumns,
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    role: EUserRolePg().notNull(),
    password: varchar({ length: 255 }).notNull(),
  },
  (t) => [
    UtilDb.activeIndex("idx_users_active", t.id),
    UtilDb.activeUniqueIndex("idx_users_tenant_email", t.tenantId, t.email),
    UtilDb.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
