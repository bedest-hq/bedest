import { uuid, pgTable, varchar } from "drizzle-orm/pg-core";
import { EUserRolePg } from "../enums/EUserRole";
import { STenant } from "@f/tenant/schemas/STenant";
import { baseColumns } from "@/common/schemas/SBase";
import { UtilDbSchema } from "@/common/utils/UtilDbSchema";

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
    UtilDbSchema.activeIndex("idx_users_active", t.id),
    UtilDbSchema.activeUniqueIndex(
      "idx_users_tenant_email",
      t.tenantId,
      t.email,
    ),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
