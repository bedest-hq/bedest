import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { and, eq } from "drizzle-orm";
import { TbSession } from "../tables/TbSession";
import { UtilDb } from "@/common/utils/UtilDb";

class ServiceSession {
  async create(
    c: IApp,
    data: {
      tenantId: string;
      userId: string;
    },
  ) {
    return await UtilDb.systemScope(c.db, async (tx) => {
      const [session] = await tx
        .insert(TbSession)
        .values({
          tenantId: data.tenantId,
          userId: data.userId,
          createdAt: c.nowDatetime,
        })
        .returning({ id: TbSession.id });
      return session;
    });
  }

  async isValid(c: IApp, id: string) {
    const session = await UtilDb.systemScope(c.db, async (tx) => {
      const [res] = await tx
        .select({ userId: TbSession.userId })
        .from(TbSession)
        .where(eq(TbSession.id, id))
        .limit(1);
      return res;
    });
    return !!session;
  }

  async remove(c: IUserApp, id: string) {
    await UtilDb.tenantScope(c, async (tx) => {
      await tx
        .delete(TbSession)
        .where(
          and(
            eq(TbSession.id, id),
            eq(TbSession.tenantId, c.tenantId),
            eq(TbSession.userId, c.session.userId),
          ),
        );
    });
  }
}

export default new ServiceSession();
