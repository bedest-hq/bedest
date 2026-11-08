import { jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Platform-wide settings shared by every node (e.g. maintenance mode)
 * [BUG-08]. System table: no tenant column, no RLS.
 */
export const SSystemSetting = pgTable("system_settings", {
  key: varchar({ length: 100 }).primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
