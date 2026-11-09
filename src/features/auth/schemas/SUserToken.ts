import { char, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { UtilDbSchema } from "bedest-core";
import { STenant } from "@f/tenant/schemas/STenant";
import { SUser } from "@f/user/schemas/SUser";
import { EUserTokenTypePg } from "../enums/EUserTokenType";

/**
 * One-time account tokens (password reset, invitation) [FEAT-06]. Only
 * the SHA-256 hex of the token is stored; the raw token exists only in
 * the e-mail. Infrastructure record (like sessions): used and expired rows
 * are hard-deleted by the tokens.cleanup job.
 */
export const SUserToken = pgTable(
  "user_tokens",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .references(() => SUser.id)
      .notNull(),
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    type: EUserTokenTypePg().notNull(),
    tokenHash: char({ length: 64 }).notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_user_tokens_user").on(t.userId, t.type),
    index("idx_user_tokens_expires_at").on(t.expiresAt),
    // RLS predicate [PERF-01].
    index("idx_user_tokens_tenant").on(t.tenantId),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
