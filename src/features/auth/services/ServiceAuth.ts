import { eq } from "drizzle-orm";
import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { TbUser } from "../../user/tables/TbUser";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

class ServiceAuth {
  async login(c: IApp, data: { email: string; password: string }) {
    const [user] = await c.db
      .select({
        userId: TbUser.id,
        role: TbUser.role,
        name: TbUser.name,
        password: TbUser.password,
      })
      .from(TbUser)
      .where(eq(TbUser.email, data.email))
      .limit(1);

    if (!user) {
      throw ErrorHandler.notFound("User doesn't exist");
    }

    const verifyPass = await Bun.password.verify(data.password, user.password);

    if (!verifyPass) {
      throw ErrorHandler.validationError("Wrong password");
    }
    return {
      userId: user.userId,
      name: user.name,
      role: user.role,
    };
  }

  async logout(c: IUserApp) {
    await ServiceSession.remove(c);
  }
}

export default new ServiceAuth();
