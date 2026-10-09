import { and, eq, gt, lt } from "drizzle-orm";
import { SSession } from "../schemas/SSession";
import { IApp, ITenantUserApp, UtilTenantScope } from "bedest-core";

class ServiceSession {
  async create(
    c: IApp,
    data: {
      tenantId: string;
      userId: string;
      expiresAt?: Date;
    },
  ) {
    const expiresAt =
      data.expiresAt ??
      new Date(c.nowDatetime.getTime() + 7 * 24 * 60 * 60 * 1000);

    return await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [session] = await tx
        .insert(SSession)
        .values({
          tenantId: data.tenantId,
          userId: data.userId,
          createdAt: c.nowDatetime,
          expiresAt,
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
        .where(and(eq(SSession.id, id), gt(SSession.expiresAt, c.nowDatetime)))
        .limit(1);
      return res;
    });
    return !!session;
  }

  async cleanExpiredSessions(c: IApp) {
    return await UtilTenantScope.systemScope(c.db, async (tx) => {
      const deleted = await tx
        .delete(SSession)
        .where(lt(SSession.expiresAt, c.nowDatetime))
        .returning({ id: SSession.id });
      return { count: deleted.length };
    });
  }

  async remove(c: ITenantUserApp, id: string) {
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

  async removeBySystem(c: IApp, sessionId: string) {
    await UtilTenantScope.systemScope(c.db, async (tx) => {
      await tx.delete(SSession).where(eq(SSession.id, sessionId));
    });
    return { success: true };
  }
}

export default new ServiceSession();
