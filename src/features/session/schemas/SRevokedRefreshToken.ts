import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Session ids that were already rotated away, kept for 7 days so that a
 * replayed (stolen) refresh token can be recognised and its whole family
 * revoked [SEC-09]. Infrastructure record: hard-deleted by the cleanup job.
 */
export const SRevokedRefreshToken = pgTable(
  "revoked_refresh_tokens",
  {
    sessionId: uuid().primaryKey(),
    familyId: uuid().notNull(),
    revokedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("idx_revoked_refresh_tokens_revoked_at").on(t.revokedAt)],
);
