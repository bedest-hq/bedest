import { and, eq, gt, lt, ne } from "drizzle-orm";
import { SSession } from "../schemas/SSession";
import { IApp, ITenantUserApp, UtilTenantScope } from "bedest-core";
import RedisManager from "@/infrastructure/redis/RedisManager";
import WsManager from "@/infrastructure/websocket/WsManager";
import { UtilSessionCache } from "../utils/UtilSessionCache";

/** Longer than any access token lives, so the marker outlives every token. */
const REVOKED_MARKER_TTL_SEC = 15 * 60 + 60;
const revokedKey = (sessionId: string) => `session:revoked:${sessionId}`;

class ServiceSession {
  private cache = new UtilSessionCache(30_000);

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

  /** The active (unexpired) session row, if any. */
  async find(c: IApp, id: string) {
    return await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [res] = await tx
        .select({
          userId: SSession.userId,
          tenantId: SSession.tenantId,
          expiresAt: SSession.expiresAt,
        })
        .from(SSession)
        .where(and(eq(SSession.id, id), gt(SSession.expiresAt, c.nowDatetime)))
        .limit(1);
      return res;
    });
  }

  async isValid(c: IApp, id: string) {
    return !!(await this.find(c, id));
  }

  /**
   * Access-path check: a revocation marker in Redis wins (cluster-wide and
   * immediate), then the local cache, then the database.
   */
  async isActive(c: IApp, sessionId: string): Promise<boolean> {
    if ((await RedisManager.get(revokedKey(sessionId))) !== null) {
      this.cache.delete(sessionId);
      return false;
    }

    const nowMs = c.nowDatetime.getTime();
    if (this.cache.has(sessionId, nowMs)) {
      return true;
    }

    const session = await this.find(c, sessionId);
    if (!session) {
      return false;
    }
    this.cache.set(sessionId, nowMs, session.expiresAt.getTime());
    return true;
  }

  private async markRevoked(sessionIds: string[]) {
    for (const id of sessionIds) {
      this.cache.delete(id);
      await RedisManager.set(revokedKey(id), "1", REVOKED_MARKER_TTL_SEC);
    }
  }

  /** Revokes one session and closes its sockets. */
  async revokeSession(c: IApp, sessionId: string) {
    await UtilTenantScope.systemScope(c.db, async (tx) => {
      await tx.delete(SSession).where(eq(SSession.id, sessionId));
    });
    await this.markRevoked([sessionId]);
    WsManager.disconnectSession(sessionId);
  }

  /**
   * Revokes every session of a user (optionally keeping one, e.g. the
   * session that just changed its own password) and closes their sockets.
   */
  async revokeUserSessions(
    c: IApp,
    userId: string,
    opts: { exceptSessionId?: string } = {},
  ) {
    const deleted = await UtilTenantScope.systemScope(c.db, (tx) =>
      tx
        .delete(SSession)
        .where(
          and(
            eq(SSession.userId, userId),
            opts.exceptSessionId
              ? ne(SSession.id, opts.exceptSessionId)
              : undefined,
          ),
        )
        .returning({ id: SSession.id }),
    );
    const ids = deleted.map((row) => row.id);
    await this.markRevoked(ids);
    for (const id of ids) {
      WsManager.disconnectSession(id);
    }
    if (!opts.exceptSessionId) {
      WsManager.disconnectUser(userId);
    }
    return ids.length;
  }

  /** Revokes every session of a tenant and closes their sockets. */
  async revokeTenantSessions(c: IApp, tenantId: string) {
    const deleted = await UtilTenantScope.systemScope(c.db, (tx) =>
      tx
        .delete(SSession)
        .where(eq(SSession.tenantId, tenantId))
        .returning({ id: SSession.id, userId: SSession.userId }),
    );
    await this.markRevoked(deleted.map((row) => row.id));
    for (const row of deleted) {
      WsManager.disconnectSession(row.id);
    }
    for (const userId of new Set(deleted.map((row) => row.userId))) {
      WsManager.disconnectUser(userId);
    }
    return deleted.length;
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
    const deleted = await UtilTenantScope.tenantScope(c, (tx) =>
      tx
        .delete(SSession)
        .where(
          and(
            eq(SSession.id, id),
            eq(SSession.tenantId, c.tenantId),
            eq(SSession.userId, c.session.userId),
          ),
        )
        .returning({ id: SSession.id }),
    );
    await this.markRevoked(deleted.map((row) => row.id));

    return { success: true };
  }

  async removeBySystem(c: IApp, sessionId: string) {
    await UtilTenantScope.systemScope(c.db, async (tx) => {
      await tx.delete(SSession).where(eq(SSession.id, sessionId));
    });
    await this.markRevoked([sessionId]);
    return { success: true };
  }

  /** Test hook: forget every cached session. */
  clearCache() {
    this.cache.clear();
  }
}

export default new ServiceSession();
