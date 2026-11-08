import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Provider webhook events already received (idempotency). Infrastructure
 * record: system-wide, no tenant column and no RLS.
 */
export const SBillingEvent = pgTable("billing_events", {
  // Provider event id, e.g. Stripe `evt_...`.
  id: varchar({ length: 255 }).primaryKey(),
  type: varchar({ length: 100 }).notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull(),
  processedAt: timestamp({ withTimezone: true }),
});
