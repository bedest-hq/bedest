import { IApp, ITenantUserApp, ServiceBase, UtilTenantScope } from "bedest-core";
import { STenant } from "../schemas/STenant";
import { and, eq } from "drizzle-orm";
import { status } from "elysia";
import type { SelectedFields } from "drizzle-orm/pg-core";
import ServiceSession from "@f/session/services/ServiceSession";
import { UtilEmail } from "@f/user/utils/UtilEmail";

class ServiceTenant extends ServiceBase<typeof STenant, string, ITenantUserApp> {
  constructor() {
    super(STenant);
  }

  /**
   * Every query runs in an RLS scope [BUG-01]: SYSTEM in systemScope (all
   * tenants), everyone else in tenantScope bound to their own tenant.
   */
  private scoped<T>(
    c: ITenantUserApp,
    fn: (scoped: ITenantUserApp) => Promise<T>,
  ): Promise<T> {
    if (c.session.isSuperUser) {
      return UtilTenantScope.systemScope(c.db, (tx) => fn({ ...c, db: tx }));
    }
    return UtilTenantScope.tenantScope(c, (tx) => fn({ ...c, db: tx }));
  }

  override async getById<TSelection extends SelectedFields>(
    c: ITenantUserApp,
    id: string,
    columns: TSelection,
  ) {
    return this.scoped(c, (sc) => super.getById(sc, id, columns));
  }

  override async getAll<TSelection extends SelectedFields>(
    c: ITenantUserApp,
    query: { limit: number; page: number },
    columns: TSelection,
  ) {
    return this.scoped(c, (sc) => super.getAll(sc, query, columns));
  }

  override async create(
    c: ITenantUserApp,
    data: Parameters<ServiceBase<typeof STenant, string, ITenantUserApp>["create"]>[1],
  ) {
    if (!c.session?.isSuperUser) {
      throw status("Forbidden");
    }
    return this.scoped(c, (sc) =>
      super.create(sc, { ...data, email: UtilEmail.normalize(data.email) }),
    );
  }

  override async update(
    c: ITenantUserApp,
    id: string,
    data: Parameters<ServiceBase<typeof STenant, string, ITenantUserApp>["update"]>[2],
  ) {
    if (typeof data.email === "string") {
      data = { ...data, email: UtilEmail.normalize(data.email) };
    }
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
      return this.scoped(c, (sc) => super.update(sc, id, allowedData));
    }
    return this.scoped(c, (sc) => super.update(sc, id, data));
  }

  override async remove(c: ITenantUserApp, id: string) {
    if (!c.session?.isSuperUser && id !== c.tenantId) {
      throw status("Forbidden");
    }
    const res = await this.scoped(c, (sc) => super.remove(sc, id));
    // Users of a deleted tenant must lose access immediately [SEC-08].
    await ServiceSession.revokeTenantSessions(c, id);
    return res;
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
