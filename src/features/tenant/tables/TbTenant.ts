import { pgTable, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { ETenantPlanPg } from "../enums/ETenantPlan";
import { baseColumns } from "@f/base/tables/TbBase";

export const TbTenant = pgTable(
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
  (t) => [index().on(t.isDeleted)],
);
