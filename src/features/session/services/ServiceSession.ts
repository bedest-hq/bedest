import { IApp, IUserApp } from "../../../common/interfaces/IContextApp";
import { and, eq } from "drizzle-orm";
import { SSession } from "../schemas/SSession";
import { UtilTenantScope } from "@/common/utils/UtilTenantScope";

class ServiceSession {
  async create(
    c: IApp,
    data: {
      tenantId: string;
      userId: string;
    },
  ) {
    return await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [session] = await tx
        .insert(SSession)
        .values({
          tenantId: data.tenantId,
          userId: data.userId,
          createdAt: c.nowDatetime,
        })
        .returning({ id: SSession.id });
      return session;
    });
  }

  async isValid(c: IApp, id: string) {
    const session = await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [res] = await tx
        .select({ userId: SSession.userId })
        .from(SSession)
        .where(eq(SSession.id, id))
        .limit(1);
      return res;
    });
    return !!session;
  }

  async remove(c: IUserApp, id: string) {
    await UtilTenantScope.tenantScope(c, async (tx) => {
      await tx
        .delete(SSession)
        .where(
          and(
            eq(SSession.id, id),
            eq(SSession.tenantId, c.tenantId),
            eq(SSession.userId, c.session.userId),
          ),
        );
    });

    return { success: true };
  }
}

export default new ServiceSession();
