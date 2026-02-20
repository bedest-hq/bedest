import { and, eq } from "drizzle-orm";
import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { TbUser } from "../../user/tables/TbUser";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { UtilDb } from "@/common/utils/UtilDb";

class ServiceAuth {
  async login(c: IApp, data: { email: string; password: string }) {
    const user = await UtilDb.systemScope(c.db, async (tx) => {
      const [res] = await tx
        .select({
          userId: TbUser.id,
          tenantId: TbUser.tenantId,
          role: TbUser.role,
          name: TbUser.name,
          password: TbUser.password,
        })
        .from(TbUser)
        .where(and(eq(TbUser.email, data.email), eq(TbUser.isDeleted, false)))
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
