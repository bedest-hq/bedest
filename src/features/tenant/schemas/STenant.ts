import { pgTable, varchar, timestamp, uuid } from "drizzle-orm/pg-core";
import { ETenantPlanPg } from "../enums/ETenantPlan";
import { baseColumns, UtilDbSchema } from "bedest-core";

export const STenant = pgTable(
  "tenants",
  {
    ...baseColumns,
    name: varchar({ length: 255 }).notNull().unique(),
    domain: varchar({ length: 255 }).notNull().unique(),
    country: varchar({ length: 255 }).notNull(),
    phones: varchar({ length: 255 }).array().notNull().default([]),
    links: varchar({ length: 255 }).array().notNull().default([]),
    email: varchar({ length: 255 }).notNull().unique(),
    address: varchar({ length: 255 }),
    city: varchar({ length: 255 }),
    state: varchar({ length: 255 }),
    zipCode: varchar({ length: 255 }),
    taxId: varchar({ length: 255 }),
    currency: varchar({ length: 3 }).notNull().default("USD"),
    timezone: varchar({ length: 255 }).notNull().default("UTC"),
    description: varchar({ length: 1000 }),
    tagline: varchar({ length: 255 }),
    workingHours: varchar({ length: 255 }),
    copyright: varchar({ length: 255 }),
    logoId: uuid(),
    plan: ETenantPlanPg().notNull(),
    planStart: timestamp({ withTimezone: true }).notNull(),
    planEnd: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    UtilDbSchema.activeIndex("idx_tenants_active", t.id),
    UtilDbSchema.tenantIsolationPolicy(t.id),
  ],
);
