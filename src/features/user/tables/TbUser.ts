import {
  uuid,
  pgTable,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { EUserRolePg } from "../enums/EUserRole";
import { sql } from "drizzle-orm";
import { TbTenant } from "@f/tenant/tables/TbTenant";
import { UtilDb } from "@/common/utils/UtilDb";
import { baseColumns } from "@f/base/tables/TbBase";

export const TbUser = pgTable(
  "users",
  {
    ...baseColumns,
    tenantId: uuid()
      .references(() => TbTenant.id)
      .notNull(),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    role: EUserRolePg().notNull(),
    password: varchar({ length: 255 }).notNull(),
  },
  (t) => [
    index().on(t.isDeleted),
    uniqueIndex()
      .on(t.email)
      .where(sql`"isDeleted" = false`),
    UtilDb.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
