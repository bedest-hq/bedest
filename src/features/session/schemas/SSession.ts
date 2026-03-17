import { UtilDb } from "@/common/utils/UtilDb";
import { STenant } from "@f/tenant/schemas/STenant";
import { uuid, pgTable, timestamp, index } from "drizzle-orm/pg-core";

export const SSession = pgTable(
  "sessions",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid().notNull(),
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },

  (t) => [index().on(t.userId), UtilDb.tenantIsolationPolicy(t.tenantId)],
).enableRLS();
