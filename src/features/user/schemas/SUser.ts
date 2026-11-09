import { sql } from "drizzle-orm";
import {
  boolean,
  uuid,
  pgTable,
  varchar,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { EUserRolePg } from "../enums/EUserRole";
import { STenant } from "@f/tenant/schemas/STenant";
import { SStorage } from "@f/storage/schemas/SStorage";
import { baseColumns, UtilDbSchema } from "bedest-core";

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
    avatarId: uuid().references(() => SStorage.id),
    password: varchar({ length: 255 }).notNull(),
    // Soft-deleted together with its tenant: a restore brings it back [FEAT-09].
    deletedWithTenant: boolean().notNull().default(false),
  },
  (t) => [
    UtilDbSchema.activeIndex("idx_users_active", t.id),
    // RLS predicate on active users [PERF-01].
    UtilDbSchema.activeIndex("idx_users_tenant", t.tenantId),
    // Case-insensitive uniqueness among active users [SEC-21].
    uniqueIndex("idx_users_email_lower")
      .on(sql`lower(${t.email})`)
      .where(sql`"isDeleted" = false`),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
