import { pgTable, varchar, timestamp } from "drizzle-orm/pg-core";
import { ETenantPlanPg } from "../enums/ETenantPlan";
import { baseColumns } from "@/common/schemas/SBase";
import { UtilDbSchema } from "@/common/utils/UtilDbSchema";

export const STenant = pgTable(
  "tenants",
  {
    ...baseColumns,
    name: varchar({ length: 255 }).notNull().unique(),
    country: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),

    plan: ETenantPlanPg().notNull(),
    planStart: timestamp({ withTimezone: true }).notNull(),
    planEnd: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    UtilDbSchema.activeIndex("idx_tenants_active", t.id),
    UtilDbSchema.tenantIsolationPolicy(t.id),
  ],
);
