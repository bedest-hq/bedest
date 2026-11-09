import { char, index, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * Failed-login counters per normalized e-mail (SHA-256 hex, never the
 * address) for the account lockout when Redis is not available [FEAT-07].
 * Infrastructure record: purged by the loginAttempts.cleanup job.
 */
export const SLoginAttempt = pgTable(
  "login_attempts",
  {
    emailHash: char({ length: 64 }).primaryKey(),
    failures: integer().notNull(),
    firstFailureAt: timestamp({ withTimezone: true }).notNull(),
    lockedUntil: timestamp({ withTimezone: true }),
  },
  (t) => [index("idx_login_attempts_first_failure").on(t.firstFailureAt)],
);
