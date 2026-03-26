import { and, eq } from "drizzle-orm";
import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { SUser } from "../../user/schemas/SUser";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { UtilTenantScope } from "@/common/utils/UtilTenantScope";
import ServiceSystem from "@f/system/services/ServiceSystem";
import { EUserRole } from "@f/user/enums/EUserRole";

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
      throw ErrorHandler.notFound("User doesn't exist");
    }

    const verifyPass = await Bun.password.verify(data.password, user.password);

    if (!verifyPass) {
      throw ErrorHandler.validationError("Wrong password");
    }

    if (ServiceSystem.getMaintenance() && user.role !== "SYSTEM") {
      throw ErrorHandler.maintenance();
    }

    const session = await ServiceSession.create(c, {
      tenantId: user.tenantId,
      userId: user.userId,
    });

    return {
      tenantId: user.tenantId,
      userId: user.userId,
      sessionId: session.id,
      role: user.role,
    };
  }

  async logout(c: IUserApp) {
    await ServiceSession.remove(c, c.session.sessionId);
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
      throw ErrorHandler.unauthorized("Session expired or invalid");
    }

    const mockUser = {
      ...c,
      tenantId: payload.tenantId,
      session: {
        userId: payload.userId,
        sessionId: payload.sessionId,
        role: payload.role,
      },
    };

    await ServiceSession.remove(mockUser, payload.sessionId);

    const newSession = await ServiceSession.create(c, {
      tenantId: payload.tenantId,
      userId: payload.userId,
    });

    return {
      tenantId: payload.tenantId,
      userId: payload.userId,
      sessionId: newSession.id,
      role: payload.role,
    };
  }
}

export default new ServiceAuth();
