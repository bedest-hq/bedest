import { STenant } from "@f/tenant/schemas/STenant";
import { UtilDbSchema } from "bedest-core";
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
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },

  (t) => [
    index().on(t.userId),
    index("idx_sessions_expires_at").on(t.expiresAt),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
