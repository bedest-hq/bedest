import { UtilHttp } from "@/common/utils/UtilHttp";
import {
  IApp,
  ITenantUserApp,
  ServiceBase,
  UtilTenantScope,
} from "bedest-core";
import { STenant } from "../schemas/STenant";
import { and, eq } from "drizzle-orm";

import type { SelectedFields } from "drizzle-orm/pg-core";
import ServiceSession from "@f/session/services/ServiceSession";
import { UtilEmail } from "@f/user/utils/UtilEmail";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import ServiceStorage from "@f/storage/services/ServiceStorage";

class ServiceTenant extends ServiceBase<
  typeof STenant,
  string,
  ITenantUserApp
> {
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
    // Only SYSTEM reads other tenants [BUG-15].
    if (!c.session.isSuperUser && id !== c.tenantId) {
      throw UtilHttp.fail(403);
    }
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
    data: Parameters<
      ServiceBase<typeof STenant, string, ITenantUserApp>["create"]
    >[1],
  ) {
    if (!c.session?.isSuperUser) {
      throw UtilHttp.fail(403);
    }
    return this.scoped(c, (sc) =>
      super.create(sc, { ...data, email: UtilEmail.normalize(data.email) }),
    );
  }

  /**
   * Creates a tenant and its first ADMIN (same e-mail) in ONE system-scope
   * transaction [BUG-16]: an e-mail already used by an active user in any
   * tenant (users.email is globally unique) is a 409 before anything is
   * written, and any later failure rolls the tenant back too.
   */
  async createWithAdmin(
    c: ITenantUserApp,
    data: Parameters<
      ServiceBase<typeof STenant, string, ITenantUserApp>["create"]
    >[1],
  ): Promise<{ id: string; password: string }> {
    if (!c.session.isSuperUser) {
      throw UtilHttp.fail(403);
    }
    const email = UtilEmail.normalize(data.email);
    // 128-bit random password until the invitation flow (FEAT-06) [SEC-23].
    const password = Buffer.from(
      crypto.getRandomValues(new Uint8Array(16)),
    ).toString("base64url");
    const passwordHash = await Bun.password.hash(password);

    const id = await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [taken] = await tx
        .select({ id: SUser.id })
        .from(SUser)
        .where(and(eq(SUser.email, email), eq(SUser.isDeleted, false)))
        .limit(1);
      if (taken) {
        throw UtilHttp.fail(409, "A user with this e-mail already exists");
      }

      const [tenant] = await tx
        .insert(STenant)
        .values({ ...data, email, createdAt: c.nowDatetime })
        .returning({ id: STenant.id });
      if (!tenant) {
        throw UtilHttp.fail(500);
      }

      await tx.insert(SUser).values({
        tenantId: tenant.id,
        name: "Admin",
        email,
        password: passwordHash,
        role: EUserRole.ADMIN,
        createdAt: c.nowDatetime,
      });
      return tenant.id;
    });

    return { id, password };
  }

  override async update(
    c: ITenantUserApp,
    id: string,
    data: Parameters<
      ServiceBase<typeof STenant, string, ITenantUserApp>["update"]
    >[2],
  ) {
    if (typeof data.email === "string") {
      data = { ...data, email: UtilEmail.normalize(data.email) };
    }
    if (!c.session?.isSuperUser && id !== c.tenantId) {
      throw UtilHttp.fail(403);
    }
    // The logo must be a READY file of this very tenant [SEC-27].
    if (typeof data.logoId === "string") {
      await ServiceStorage.assertAttachable(c, id, data.logoId);
    }
    if (!c.session?.isSuperUser) {
      const allowedData = { ...data };
      // A copy: the caller's object (the request body) is never mutated.
      delete allowedData.plan;
      delete allowedData.planStart;
      delete allowedData.planEnd;
      return this.scoped(c, (sc) => super.update(sc, id, allowedData));
    }
    return this.scoped(c, (sc) => super.update(sc, id, data));
  }

  override async remove(c: ITenantUserApp, id: string) {
    // Deleting a tenant is a SYSTEM operation, like its route [BUG-15].
    if (!c.session.isSuperUser) {
      throw UtilHttp.fail(403, "Only SYSTEM can delete tenants");
    }
    // Never orphan the platform or lock the actor out [SEC-13].
    if (id === c.tenantId) {
      throw UtilHttp.fail(409, "Cannot delete the tenant of the acting user");
    }
    const [target] = await UtilTenantScope.systemScope(c.db, (tx) =>
      tx
        .select({ isSystem: STenant.isSystem })
        .from(STenant)
        .where(and(eq(STenant.id, id), eq(STenant.isDeleted, false)))
        .limit(1),
    );
    if (target?.isSystem) {
      throw UtilHttp.fail(409, "Cannot delete the system tenant");
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
        // Neutral copy: the endpoint is public [SEC-25].
        throw UtilHttp.fail(404, "Tenant not found");
      }

      return tenant;
    });
  }
}

export default new ServiceTenant();
