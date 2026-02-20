import { pgEnum } from "drizzle-orm/pg-core";

export enum ETenantPlan {
  BASIC = "BASIC",
  STANDART = "STANDART",
  PROFESSIONAL = "PROFESSIONAL",
}
export const ETenantPlanPg = pgEnum("plans", [
  ETenantPlan.BASIC,
  ETenantPlan.STANDART,
  ETenantPlan.PROFESSIONAL,
]);
