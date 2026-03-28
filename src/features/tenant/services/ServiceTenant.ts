import { IApp } from "@/common/interfaces/IContextApp";
import { ServiceBase } from "../../../common/services/ServiceBase";
import { STenant } from "../schemas/STenant";
import { UtilTenantScope } from "@/common/utils/UtilTenantScope";
import { eq } from "drizzle-orm";

class ServiceTenant extends ServiceBase<typeof STenant, string> {
  constructor() {
    super(STenant);
  }

  async checkPlan(c: IApp, tenantId: string) {
    const [tenant] = await UtilTenantScope.systemScope(c.db, async (tx) => {
      return tx
        .select({ plan: STenant.plan, planEnd: STenant.planEnd })
        .from(STenant)
        .where(eq(STenant.id, tenantId))
        .limit(1);
    });
    return tenant;
  }
}

export default new ServiceTenant();
