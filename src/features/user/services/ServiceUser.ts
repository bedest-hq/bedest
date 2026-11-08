import { EUserRole } from "../enums/EUserRole";
import { SUser } from "../schemas/SUser";
import { status } from "elysia";
import { and, count, eq, ne } from "drizzle-orm";
import { ITenantUserApp, ServiceBaseTenant, UtilTenantScope } from "bedest-core";
import { IPolicyActor, UtilUserPolicy } from "../utils/UtilUserPolicy";
import { UtilEmail } from "../utils/UtilEmail";
import ServiceSession from "@f/session/services/ServiceSession";

class ServiceUser extends ServiceBaseTenant<typeof SUser, string> {
  constructor() {
    super(SUser);
  }

  private actor(c: ITenantUserApp): IPolicyActor {
    return {
      role: c.session.role,
      userId: c.session.userId,
      tenantId: c.tenantId,
    };
  }

  /**
   * Loads an active user the actor can see: any tenant for SYSTEM, the
   * actor's own tenant otherwise (404 when not visible).
   */
  private async loadTarget(c: ITenantUserApp, id: string) {
    const columns = {
      id: SUser.id,
      role: SUser.role,
      tenantId: SUser.tenantId,
      password: SUser.password,
    };
    const active = and(eq(SUser.id, id), eq(SUser.isDeleted, false));

    const [row] = c.session.isSuperUser
      ? await UtilTenantScope.systemScope(c.db, (tx) =>
          tx.select(columns).from(SUser).where(active).limit(1),
        )
      : await UtilTenantScope.tenantScope(c, (tx) =>
          tx
            .select(columns)
            .from(SUser)
            .where(and(active, eq(SUser.tenantId, c.tenantId)))
            .limit(1),
        );

    if (!row) {
      throw status("Not Found");
    }
    return row;
  }

  async create(
    c: ITenantUserApp,
    data: {
      name: string;
      email: string;
      password: string;
      role: EUserRole;
      avatarId?: string;
    },
  ) {
    if (!UtilUserPolicy.canGrantRole(c.session.role, data.role)) {
      throw status("Forbidden");
    }

    const hash = await Bun.password.hash(data.password);

    return super.create(c, {
      ...data,
      email: UtilEmail.normalize(data.email),
      password: hash,
    });
  }

  async getAll(c: ITenantUserApp, query: { limit: number; page: number }) {
    return super.getAll(c, query, {
      id: SUser.id,
      tenantId: SUser.tenantId,
      name: SUser.name,
      role: SUser.role,
      avatarId: SUser.avatarId,
      createdAt: SUser.createdAt,
    });
  }

  async getById(c: ITenantUserApp, id: string) {
    return super.getById(c, id, {
      name: SUser.name,
      role: SUser.role,
      email: SUser.email,
      avatarId: SUser.avatarId,
      createdAt: SUser.createdAt,
    });
  }

  async update(
    c: ITenantUserApp,
    id: string,
    data: {
      name?: string;
      password?: string;
      currentPassword?: string;
      avatarId?: string;
      role?: EUserRole;
    },
  ) {
    const actor = this.actor(c);
    const target = await this.loadTarget(c, id);

    if (UtilUserPolicy.isSelf(actor, target)) {
      if (data.role !== undefined) {
        throw status("Forbidden", { message: "You cannot change your own role" });
      }
      if (data.password) {
        if (!data.currentPassword) {
          throw status("Bad Request", {
            message: "currentPassword is required to change your password",
          });
        }
        const valid = await Bun.password.verify(
          data.currentPassword,
          target.password,
        );
        if (!valid) {
          throw status("Unauthorized", { message: "Wrong current password" });
        }
      }
    } else {
      if (!UtilUserPolicy.canManage(actor, target)) {
        throw status("Forbidden");
      }
      if (
        data.role !== undefined &&
        !UtilUserPolicy.canGrantRole(actor.role, data.role)
      ) {
        throw status("Forbidden");
      }
    }

    const payload: Partial<typeof SUser.$inferInsert> = {};

    if (data.name) {
      payload.name = data.name;
    }
    if (data.password) {
      payload.password = await Bun.password.hash(data.password);
    }
    if (data.avatarId) {
      payload.avatarId = data.avatarId;
    }
    if (data.role !== undefined) {
      payload.role = data.role;
    }

    await super.update(c, id, payload);

    // Credentials or privileges changed: old sessions must not survive
    // [SEC-08]. Your own password change keeps the current session only.
    const roleChanged = data.role !== undefined && data.role !== target.role;
    if (data.password || roleChanged) {
      await ServiceSession.revokeUserSessions(c, id, {
        exceptSessionId:
          UtilUserPolicy.isSelf(actor, target) && !roleChanged
            ? c.session.sessionId
            : undefined,
      });
    }

    return { success: true };
  }

  /**
   * Refuses to delete the last active ADMIN of a tenant or the last active
   * SYSTEM user of the platform (self-lockout, orphaned tenants) [SEC-13].
   */
  private async assertNotLastPrivileged(
    c: ITenantUserApp,
    target: { id: string; role: string; tenantId: string },
  ) {
    if (target.role !== EUserRole.ADMIN && target.role !== EUserRole.SYSTEM) {
      return;
    }
    const sameRole = and(
      eq(SUser.role, target.role === EUserRole.ADMIN ? EUserRole.ADMIN : EUserRole.SYSTEM),
      eq(SUser.isDeleted, false),
      ne(SUser.id, target.id),
      target.role === EUserRole.ADMIN ? eq(SUser.tenantId, target.tenantId) : undefined,
    );
    const [others] = await UtilTenantScope.systemScope(c.db, (tx) =>
      tx.select({ n: count() }).from(SUser).where(sameRole),
    );
    if (Number(others?.n ?? 0) === 0) {
      throw status("Conflict", {
        message:
          target.role === EUserRole.ADMIN
            ? "Cannot delete the last active ADMIN of the tenant"
            : "Cannot delete the last active SYSTEM user",
      });
    }
  }

  override async remove(c: ITenantUserApp, id: string) {
    const target = await this.loadTarget(c, id);

    if (!UtilUserPolicy.canManage(this.actor(c), target)) {
      throw status("Forbidden");
    }

    await this.assertNotLastPrivileged(c, target);

    const res = await super.remove(c, id);
    await ServiceSession.revokeUserSessions(c, id);
    return res;
  }
}

export default new ServiceUser();
