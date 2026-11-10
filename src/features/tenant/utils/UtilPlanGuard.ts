import { MacroPlanGuard, type PlanChecker } from "bedest-core";
import DbManager from "@/infrastructure/database/DbManager";
import ServiceTenant from "../services/ServiceTenant";
import { ETenantPlan } from "../enums/ETenantPlan";

const planChecker: PlanChecker = (tenantId, nowDatetime) =>
  ServiceTenant.checkPlan({ db: DbManager.get(), nowDatetime }, tenantId);

/**
 * Opt-in plan gate [QLT-05]. Register it on a router that needs it, after
 * Context.User():
 *
 *   new Elysia().use(Context.User()).macro("PlanGuard", UtilPlanGuard.macro)
 *     .get("/reports", handler, { PlanGuard: [ETenantPlan.PROFESSIONAL] })
 *
 * Uncached, so a plan change (e.g. a billing webhook) applies to the next
 * request; pass bedest-core's `cacheTtlMs` (CORE-07) to MacroPlanGuard
 * directly if lookups get hot.
 */
export class UtilPlanGuard {
  static macro(plans: ETenantPlan[]) {
    return MacroPlanGuard(plans, planChecker);
  }
}
