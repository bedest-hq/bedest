import { STenant } from "@f/tenant/schemas/STenant";
import { UtilDbSchema } from "bedest-core";
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
    // Null when the request names no entity (never the actor) [BUG-11].
    entityId: uuid(),
    // Tenant a SYSTEM action changed, when it is not the actor's [BUG-11].
    targetTenantId: uuid().references(() => STenant.id),

    payload: jsonb().$type<Record<string, unknown>>().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_logs_entity").on(t.entity, t.entityId),
    // Tenant audit log, newest first [PERF-01].
    index("idx_audit_logs_tenant_created").on(
      t.tenantId,
      t.createdAt.desc().nullsFirst(),
    ),
    UtilDbSchema.tenantIsolationPolicy(t.tenantId),
  ],
).enableRLS();
