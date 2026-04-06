import { IApp } from "@/common/interfaces/IContextApp";
import { ServiceBase } from "../../../common/services/ServiceBase";
import { STenant } from "../schemas/STenant";
import { UtilTenantScope } from "@/common/utils/UtilTenantScope";
import { and, eq } from "drizzle-orm";
import { status } from "elysia";

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

  async checkDomain(c: IApp, domain: string) {
    return await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [tenant] = await tx
        .select({
          id: STenant.id,
          name: STenant.name,
          logoId: STenant.logoId,
        })
        .from(STenant)
        .where(and(eq(STenant.domain, domain), eq(STenant.isDeleted, false)))
        .limit(1);

      if (!tenant) {
        throw status("Not Found", "No publication found for this domain.");
      }

      return tenant;
    });
  }
}

export default new ServiceTenant();
