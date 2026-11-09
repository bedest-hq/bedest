import { STenant } from "@f/tenant/schemas/STenant";
import { UtilDbSchema } from "bedest-core";
import { uuid, pgTable, timestamp, index, varchar } from "drizzle-orm/pg-core";
import { SUser } from "@f/user/schemas/SUser";

export const SSession = pgTable(
  "sessions",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .references(() => SUser.id)
      .notNull(),
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    // All sessions produced by rotating one login share a family [SEC-09].
    familyId: uuid().defaultRandom().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    // Session management [FEAT-05]: written at most every 5 minutes.
    lastUsedAt: timestamp({ withTimezone: true }),
    ipAddress: varchar({ length: 45 }),
    userAgent: varchar({ length: 512 }),
  },

  (t) => [
    index().on(t.userId),
    index("idx_sessions_expires_at").on(t.expiresAt),
    index("idx_sessions_family").on(t.familyId),
    // RLS predicate [PERF-01].
    index("idx_sessions_tenant").on(t.tenantId),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
