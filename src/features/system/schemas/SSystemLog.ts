import { UtilDbSchema } from "@/common/utils/UtilDbSchema";
import { STenant } from "@f/tenant/schemas/STenant";
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const SSystemLog = pgTable(
  "system_audit_logs",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid()
      .references(() => STenant.id)
      .notNull(),
    userId: uuid().notNull(),

    action: varchar({ length: 100 }).notNull(),
    entity: varchar({ length: 100 }).notNull(),
    entityId: uuid().notNull(),

    payload: jsonb().$type<Record<string, unknown>>().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_logs_entity").on(t.entity, t.entityId),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
