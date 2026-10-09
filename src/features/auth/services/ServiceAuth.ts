import { and, eq } from "drizzle-orm";
import { SUser } from "../../user/schemas/SUser";
import ServiceSession from "@/features/session/services/ServiceSession";
import ServiceSystem from "@f/system/services/ServiceSystem";
import { EUserRole } from "@f/user/enums/EUserRole";
import { status } from "elysia";
import ServiceSystemLog from "@f/system/services/ServiceSystemLog";
import { IApp, ITenantUserApp, UtilTenantScope } from "bedest-core";
import WsManager from "@/infrastructure/websocket/WsManager";

const DUMMY_HASH = await Bun.password.hash("invalid_dummy_password");

class ServiceAuth {
  async login(c: IApp, data: { email: string; password: string }) {
    const user = await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [res] = await tx
        .select({
          userId: SUser.id,
          tenantId: SUser.tenantId,
          role: SUser.role,
          password: SUser.password,
        })
        .from(SUser)
        .where(and(eq(SUser.email, data.email), eq(SUser.isDeleted, false)))
        .limit(1);
      return res;
    });

    if (!user) {
      await Bun.password.verify(data.password, DUMMY_HASH);
      throw status("Unauthorized", { message: "Invalid email or password" });
    }

    const verifyPass = await Bun.password.verify(data.password, user.password);

    if (!verifyPass) {
      throw status("Unauthorized", { message: "Invalid email or password" });
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
        payload: { email: data.email },
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
    WsManager.disconnectUser(c.session.userId);
  }

  async refresh(
    c: IApp,
    payload: {
      sessionId: string;
      tenantId: string;
      userId: string;
      role: EUserRole;
    },
  ) {
    const isValid = await ServiceSession.isValid(c, payload.sessionId);

    if (!isValid) {
      throw status("Unauthorized");
    }

    await ServiceSession.removeBySystem(c, payload.sessionId);

    const newSession = await ServiceSession.create(c, {
      tenantId: payload.tenantId,
      userId: payload.userId,
    });

    void ServiceSystemLog.log(
      {
        db: c.db,
        nowDatetime: c.nowDatetime,
        tenantId: payload.tenantId,
        session: {
          userId: payload.userId,
          role: payload.role,
          sessionId: newSession.id,
          isSuperUser: payload.role === EUserRole.SYSTEM,
        },
      },
      {
        action: "REFRESH_TOKEN",
        entity: "auth",
        entityId: payload.userId,
        payload: {
          oldSessionId: payload.sessionId,
          newSessionId: newSession.id,
        },
      },
    );

    return {
      tenantId: payload.tenantId,
      userId: payload.userId,
      sessionId: newSession.id,
      role: payload.role,
    };
  }
}
export default new ServiceAuth();
