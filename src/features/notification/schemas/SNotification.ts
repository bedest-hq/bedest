import { STenant } from "@f/tenant/schemas/STenant";
import { baseColumns, UtilDbSchema } from "bedest-core";
import {
  uuid,
  pgTable,
  varchar,
  jsonb,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const SNotification = pgTable(
  "notifications",
  {
    ...baseColumns,
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    userId: uuid(),
    isBroadcast: boolean().default(false).notNull(),
    event: varchar({ length: 100 }).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    isRead: boolean().notNull().default(false),
    readAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    UtilDbSchema.activeIndex("idx_notifications_user", t.userId, t.tenantId),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();

export const SNotificationRead = pgTable(
  "notification_reads",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    notificationId: uuid()
      .references(() => SNotification.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid().notNull(),
    readAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    // One receipt per (user, notification) [BUG-05]; leading userId also
    // serves the per-user lookups (PERF-01).
    uniqueIndex("uq_notification_reads_user_notification").on(
      t.userId,
      t.notificationId,
    ),
    index("idx_notification_reads_notif").on(t.notificationId),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
