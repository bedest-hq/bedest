import { baseColumns } from "@/common/schemas/SBase";
import { UtilDbSchema } from "@/common/utils/UtilDbSchema";
import { STenant } from "@f/tenant/schemas/STenant";
import {
  uuid,
  pgTable,
  varchar,
  jsonb,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const SNotification = pgTable(
  "notifications",
  {
    ...baseColumns,
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    userId: uuid().notNull(),
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
