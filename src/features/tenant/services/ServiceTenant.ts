import { IApp, ITenantUserApp, ServiceBase, UtilTenantScope } from "bedest-core";
import { STenant } from "../schemas/STenant";
import { and, eq } from "drizzle-orm";
import { status } from "elysia";

class ServiceTenant extends ServiceBase<typeof STenant, string, ITenantUserApp> {
  constructor() {
    super(STenant);
  }

  override async create(
    c: ITenantUserApp,
    data: Parameters<ServiceBase<typeof STenant, string, ITenantUserApp>["create"]>[1],
  ) {
    if (!c.session?.isSuperUser) {
      throw status("Forbidden");
    }
    return super.create(c, data);
  }

  override async update(
    c: ITenantUserApp,
    id: string,
    data: Parameters<ServiceBase<typeof STenant, string, ITenantUserApp>["update"]>[2],
  ) {
    if (!c.session?.isSuperUser) {
      if (id !== c.tenantId) {
        throw status("Forbidden");
      }
      const allowedData = { ...data };
      delete (allowedData as Record<string, unknown>).plan;
      delete (allowedData as Record<string, unknown>).planStart;
      delete (allowedData as Record<string, unknown>).planEnd;
      if (Object.keys(allowedData).length === 0) {
        return { success: true };
      }
      return super.update(c, id, allowedData);
    }
    return super.update(c, id, data);
  }

  override async remove(c: ITenantUserApp, id: string) {
    if (!c.session?.isSuperUser && id !== c.tenantId) {
      throw status("Forbidden");
    }
    return super.remove(c, id);
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
