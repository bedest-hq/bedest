import { UtilHttp } from "@/common/utils/UtilHttp";
import { and, eq, sql } from "drizzle-orm";
import { SUser } from "../../user/schemas/SUser";
import { STenant } from "@f/tenant/schemas/STenant";
import { UtilEmail } from "@f/user/utils/UtilEmail";
import ServiceSession from "@/features/session/services/ServiceSession";
import ServiceSystem from "@f/system/services/ServiceSystem";
import { EUserRole } from "@f/user/enums/EUserRole";

import ServiceSystemLog from "@f/system/services/ServiceSystemLog";
import { IApp, ITenantUserApp, TDbOrTx, UtilTenantScope } from "bedest-core";
import WsManager from "@/infrastructure/websocket/WsManager";
import ServiceLoginLockout, { emailHashOf } from "./ServiceLoginLockout";

const DUMMY_HASH = await Bun.password.hash("invalid_dummy_password");

const invalidCredentials = () =>
  UtilHttp.fail(401, "Invalid email or password");

class ServiceAuth {
  /** Active user of an active tenant, straight from the database. */
  private async loadPrincipal(tx: TDbOrTx, userId: string) {
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

  /** The tenant that owns the platform (audit target for unknown e-mails). */
  private async systemTenantId(c: IApp): Promise<string | undefined> {
    const [row] = await UtilTenantScope.systemScope(c.db, (tx) =>
      tx
        .select({ id: STenant.id })
        .from(STenant)
        .where(and(eq(STenant.isSystem, true), eq(STenant.isDeleted, false)))
        .limit(1),
    );
    return row?.id;
  }

  /**
   * LOGIN_FAILED / LOGIN_LOCKED system events [FEAT-07]: e-mail hash, IP
   * and user agent only — never the password or the address. Recorded in
   * the user's tenant, or the system tenant when the e-mail is unknown.
   */
  private async auditLoginEvent(
    c: IApp,
    action: "LOGIN_FAILED" | "LOGIN_LOCKED",
    tenantId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const target = tenantId ?? (await this.systemTenantId(c));
    if (!target) {
      return;
    }
    await ServiceSystemLog.logEvent(c.db, {
      tenantId: target,
      action,
      entity: "auth",
      entityId: null,
      payload,
    });
  }

  async login(
    c: IApp,
    data: { email: string; password: string },
    meta: { ip: string; userAgent: string } = { ip: "unknown", userAgent: "" },
  ) {
    const email = UtilEmail.normalize(data.email);
    const emailHash = emailHashOf(email);
    const auditPayload = {
      emailHash,
      ip: meta.ip,
      userAgent: meta.userAgent.slice(0, 512),
    };

    // Locked: the same work and the same answer as a wrong password, and
    // the password is not checked at all [FEAT-07].
    if (await ServiceLoginLockout.isLocked(c, emailHash)) {
      await Bun.password.verify(data.password, DUMMY_HASH);
      await this.auditLoginEvent(c, "LOGIN_FAILED", undefined, {
        ...auditPayload,
        locked: true,
      });
      throw invalidCredentials();
    }

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

    const verifyPass = user
      ? await Bun.password.verify(data.password, user.password)
      : await Bun.password.verify(data.password, DUMMY_HASH).then(() => false);

    if (!user || !verifyPass) {
      const { lockedNow } = await ServiceLoginLockout.recordFailure(
        c,
        emailHash,
      );
      await this.auditLoginEvent(
        c,
        "LOGIN_FAILED",
        user?.tenantId,
        auditPayload,
      );
      if (lockedNow) {
        await this.auditLoginEvent(
          c,
          "LOGIN_LOCKED",
          user?.tenantId,
          auditPayload,
        );
      }
      throw invalidCredentials();
    }

    await ServiceLoginLockout.reset(c, emailHash);

    if ((await ServiceSystem.getMaintenance(c)) && user.role !== "SYSTEM") {
      throw UtilHttp.fail(503);
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
    await ServiceSystemLog.log(c, {
      action: "LOGOUT",
      entity: "session",
      entityId: c.session.sessionId,
      payload: {},
    });
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
      throw UtilHttp.fail(401);
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
