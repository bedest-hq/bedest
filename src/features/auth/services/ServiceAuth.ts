import { and, eq, sql } from "drizzle-orm";
import { SUser } from "../../user/schemas/SUser";
import { STenant } from "@f/tenant/schemas/STenant";
import { UtilEmail } from "@f/user/utils/UtilEmail";
import ServiceSession from "@/features/session/services/ServiceSession";
import ServiceSystem from "@f/system/services/ServiceSystem";
import { EUserRole } from "@f/user/enums/EUserRole";
import { status } from "elysia";
import ServiceSystemLog from "@f/system/services/ServiceSystemLog";
import {
  IApp,
  ITenantUserApp,
  TTransaction,
  UtilTenantScope,
} from "bedest-core";
import WsManager from "@/infrastructure/websocket/WsManager";

const DUMMY_HASH = await Bun.password.hash("invalid_dummy_password");

const invalidCredentials = () =>
  status("Unauthorized", { message: "Invalid email or password" });

class ServiceAuth {
  /** Active user of an active tenant, straight from the database. */
  private async loadPrincipal(tx: TTransaction, userId: string) {
    const [row] = await tx
      .select({
        userId: SUser.id,
        tenantId: SUser.tenantId,
        role: SUser.role,
      })
      .from(SUser)
      .innerJoin(STenant, eq(STenant.id, SUser.tenantId))
      .where(
        and(
          eq(SUser.id, userId),
          eq(SUser.isDeleted, false),
          eq(STenant.isDeleted, false),
        ),
      )
      .limit(1);
    return row;
  }

  async login(c: IApp, data: { email: string; password: string }) {
    const email = UtilEmail.normalize(data.email);
    const user = await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [res] = await tx
        .select({
          userId: SUser.id,
          tenantId: SUser.tenantId,
          role: SUser.role,
          password: SUser.password,
        })
        .from(SUser)
        .innerJoin(STenant, eq(STenant.id, SUser.tenantId))
        .where(
          and(
            // Matches the unique index on lower(email) [SEC-21].
            sql`lower(${SUser.email}) = ${email}`,
            eq(SUser.isDeleted, false),
            eq(STenant.isDeleted, false),
          ),
        )
        .limit(1);
      return res;
    });

    if (!user) {
      await Bun.password.verify(data.password, DUMMY_HASH);
      throw invalidCredentials();
    }

    const verifyPass = await Bun.password.verify(data.password, user.password);

    if (!verifyPass) {
      throw invalidCredentials();
    }

    if ((await ServiceSystem.getMaintenance()) && user.role !== "SYSTEM") {
      throw status("Service Unavailable");
    }

    const session = await ServiceSession.create(c, {
      tenantId: user.tenantId,
      userId: user.userId,
    });

    void ServiceSystemLog.log(
      {
        db: c.db,
        nowDatetime: c.nowDatetime,
        tenantId: user.tenantId,
        session: {
          userId: user.userId,
          role: user.role,
          sessionId: session.id,
          isSuperUser: user.role === EUserRole.SYSTEM,
        },
      },
      {
        action: "LOGIN",
        entity: "auth",
        entityId: user.userId,
        payload: { email },
      },
    );

    return {
      tenantId: user.tenantId,
      userId: user.userId,
      sessionId: session.id,
      role: user.role,
    };
  }

  async logout(c: ITenantUserApp) {
    await ServiceSession.remove(c, c.session.sessionId);
    // Only this device: other sessions of the user stay connected [BUG-06].
    WsManager.disconnectSession(c.session.sessionId);
  }

  /**
   * Rotates a refresh session. Identity, tenant and role are re-read from
   * the database (never copied from the presented token), so deleted users,
   * deleted tenants and role changes take effect at the next refresh.
   */
  async refresh(c: IApp, sessionId: string) {
    // Delete-and-reinsert in one transaction [SEC-09]; the principal is
    // re-read from the database inside it [SEC-08].
    const rotated = await ServiceSession.rotate(c, sessionId, (tx, userId) =>
      this.loadPrincipal(tx, userId),
    );

    if (!rotated) {
      throw status("Unauthorized");
    }

    const { principal } = rotated;
    const newSession = { id: rotated.sessionId };

    void ServiceSystemLog.log(
      {
        db: c.db,
        nowDatetime: c.nowDatetime,
        tenantId: principal.tenantId,
        session: {
          userId: principal.userId,
          role: principal.role,
          sessionId: newSession.id,
          isSuperUser: principal.role === EUserRole.SYSTEM,
        },
      },
      {
        action: "REFRESH_TOKEN",
        entity: "auth",
        entityId: principal.userId,
        payload: {
          oldSessionId: sessionId,
          newSessionId: newSession.id,
        },
      },
    );

    return {
      tenantId: principal.tenantId,
      userId: principal.userId,
      sessionId: newSession.id,
      role: principal.role,
    };
  }
}
export default new ServiceAuth();
