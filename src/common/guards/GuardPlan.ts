import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";
import ServiceTenant from "@/features/tenant/services/ServiceTenant";
import { IUserApp } from "@/common/interfaces/IContextApp";
import { status } from "elysia";

export const MacroPlanGuard = (plans: ETenantPlan[]) => ({
  async beforeHandle({ userRuntime }: { userRuntime?: IUserApp }) {
    if (!userRuntime) {
      throw status(401, "Authentication required.");
    }

    const tenant = await ServiceTenant.checkPlan(
      { db: userRuntime.db, nowDatetime: userRuntime.nowDatetime },
      userRuntime.tenantId,
    );

    if (!tenant) {
      throw status(404, "Tenant not found.");
    }

    if (tenant.planEnd < userRuntime.nowDatetime) {
      throw status(402, "Your plan has expired. Please renew to continue.");
    }

    if (!plans.includes(tenant.plan)) {
      throw status(
        403,
        "Your current plan does not support this feature. Please upgrade.",
      );
    }
  },
});
