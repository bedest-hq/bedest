import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";
import ServiceTenant from "@/features/tenant/services/ServiceTenant";
import { IUserApp } from "@/common/interfaces/IContextApp";
import { status } from "elysia";

export const MacroPlanGuard = (plans: ETenantPlan[]) => ({
  async beforeHandle({ userRuntime }: { userRuntime?: IUserApp }) {
    if (!userRuntime) {
      throw status("Unauthorized");
    }

    const tenant = await ServiceTenant.checkPlan(
      { db: userRuntime.db, nowDatetime: userRuntime.nowDatetime },
      userRuntime.tenantId,
    );

    if (!tenant) {
      throw status("Not Found");
    }

    if (tenant.planEnd < userRuntime.nowDatetime) {
      throw status("Payment Required");
    }

    if (!plans.includes(tenant.plan)) {
      throw status("Upgrade Required");
    }
  },
});
