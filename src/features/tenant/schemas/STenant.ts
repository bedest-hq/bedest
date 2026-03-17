import { pgTable, varchar, timestamp } from "drizzle-orm/pg-core";
import { ETenantPlanPg } from "../enums/ETenantPlan";
import { baseColumns } from "@/common/schemas/SBase";
import { UtilDb } from "@/common/utils/UtilDb";

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
    UtilDb.activeIndex("idx_tenants_active", t.id),
    UtilDb.tenantIsolationPolicy(t.id),
  ],
);
