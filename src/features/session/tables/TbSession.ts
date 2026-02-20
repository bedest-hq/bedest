import { UtilDb } from "@/common/utils/UtilDb";
import { TbTenant } from "@f/tenant/tables/TbTenant";
import { uuid, pgTable, timestamp, index } from "drizzle-orm/pg-core";

export const TbSession = pgTable(
  "sessions",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid().notNull(),
    tenantId: uuid()
      .references(() => TbTenant.id)
      .notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },

  (t) => [index().on(t.userId), UtilDb.tenantIsolationPolicy(t.tenantId)],
).enableRLS();
