import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { and, eq } from "drizzle-orm";
import { TbSession } from "../tables/TbSession";
import { TbUser } from "@f/user/tables/TbUser";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

class ServiceSession {
  async create(
    c: IApp,
    data: {
      userId: string;
    },
  ) {
    const [session] = await c.db
      .insert(TbSession)
      .values({
        userId: data.userId,
        createdAt: c.nowDatetime,
      })
      .returning({ id: TbSession.id });

    return session;
  }
  async remove(c: IUserApp) {
    await c.db
      .delete(TbSession)
      .where(
        and(
          eq(TbSession.userId, c.session.userId),
          eq(TbSession.id, c.session.sessionId),
        ),
      );
  }

  async isValid(c: IApp, userId: string, sessionId: string) {
    const [user] = await c.db
      .select({ role: TbUser.role })
      .from(TbUser)
      .where(and(eq(TbUser.id, userId), eq(TbUser.isDeleted, false)))
      .limit(1);

    if (!user) {
      throw ErrorHandler.unauthorized("User not found or suspended");
    }

    const [session] = await c.db
      .select({ userId: TbSession.userId })
      .from(TbSession)
      .where(and(eq(TbSession.userId, userId), eq(TbSession.id, sessionId)))
      .limit(1);

    return { isActive: !!session, user };
  }
}

export default new ServiceSession();
