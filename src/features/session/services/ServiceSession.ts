import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { eq } from "drizzle-orm";
import { TbSession } from "../tables/TbSession";

class ServiceSession {
  async create(
    c: IApp,
    data: {
      userId: string;
    },
  ) {
    await c.db.insert(TbSession).values({
      userId: data.userId,
      createdAt: c.nowDatetime,
    });
  }
  async remove(c: IUserApp) {
    await c.db.delete(TbSession).where(eq(TbSession.userId, c.session.userId));
  }

  async isValid(c: IApp, userId: string) {
    const [session] = await c.db
      .select({ userId: TbSession.userId })
      .from(TbSession)
      .where(eq(TbSession.userId, userId))
      .limit(1);
    return !!session;
  }
}

export default new ServiceSession();
