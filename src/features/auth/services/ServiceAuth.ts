import { and, eq } from "drizzle-orm";
import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { SUser } from "../../user/schemas/SUser";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { UtilDb } from "@/common/utils/UtilDb";

class ServiceAuth {
  async login(c: IApp, data: { email: string; password: string }) {
    const user = await UtilDb.systemScope(c.db, async (tx) => {
      const [res] = await tx
        .select({
          userId: SUser.id,
          tenantId: SUser.tenantId,
          role: SUser.role,
          name: SUser.name,
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
    return {
      userId: user.userId,
      tenantId: user.tenantId,
      name: user.name,
      role: user.role,
    };
  }

  async logout(c: IUserApp) {
    await ServiceSession.remove(c, c.session.sessionId);
  }
}

export default new ServiceAuth();
