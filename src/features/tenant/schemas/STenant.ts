import {
  pgTable,
  varchar,
  timestamp,
  uuid,
  boolean,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { ETenantPlanPg } from "../enums/ETenantPlan";
import { baseColumns, UtilDbSchema } from "bedest-core";
import { SStorage } from "@f/storage/schemas/SStorage";

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
    // A READY file of this tenant (checked by ServiceStorage.assertAttachable)
    // [SEC-27].
    // AnyPgColumn: storage_files references tenants too (circular types).
    logoId: uuid().references((): AnyPgColumn => SStorage.id),
    plan: ETenantPlanPg().notNull(),
    planStart: timestamp({ withTimezone: true }).notNull(),
    planEnd: timestamp({ withTimezone: true }).notNull(),
    subscriptionId: varchar({ length: 255 }),
    customerId: varchar({ length: 255 }),
    // The tenant that owns the platform SYSTEM users; never deletable
    // [SEC-13]. Set by the seed.
    isSystem: boolean().notNull().default(false),
  },
  (t) => [
    UtilDbSchema.activeIndex("idx_tenants_active", t.id),
    UtilDbSchema.tenantIsolationPolicy(t.id),
  ],
).enableRLS();
