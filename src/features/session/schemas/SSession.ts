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
    // All sessions produced by rotating one login share a family [SEC-09].
    familyId: uuid().defaultRandom().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },

  (t) => [
    index().on(t.userId),
    index("idx_sessions_expires_at").on(t.expiresAt),
    index("idx_sessions_family").on(t.familyId),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
