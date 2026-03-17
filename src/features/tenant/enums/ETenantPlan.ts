import { pgEnum } from "drizzle-orm/pg-core";

export enum ETenantPlan {
  BASIC = "BASIC",
  STANDARD = "STANDARD",
  PROFESSIONAL = "PROFESSIONAL",
}
export const ETenantPlanPg = pgEnum("plans", [
  ETenantPlan.BASIC,
  ETenantPlan.STANDARD,
  ETenantPlan.PROFESSIONAL,
]);
