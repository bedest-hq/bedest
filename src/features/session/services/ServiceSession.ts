import { and, eq, gt, lt, ne } from "drizzle-orm";
import { SSession } from "../schemas/SSession";
import {
  IApp,
  ITenantUserApp,
  TDbOrTx,
  UtilTenantScope,
} from "bedest-core";
import RedisManager from "@/infrastructure/redis/RedisManager";
import WsManager from "@/infrastructure/websocket/WsManager";
import { UtilSessionCache } from "../utils/UtilSessionCache";
import { SRevokedRefreshToken } from "../schemas/SRevokedRefreshToken";
import { logger } from "@/infrastructure/logger/logger";

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

  /**
   * Atomically rotates a refresh session [SEC-09]: the old row is deleted
   * with `DELETE ... RETURNING` and the new one inserted in the same
   * transaction, so two concurrent refreshes cannot both succeed. A session
   * id that was already rotated away is token reuse: every session of its
   * family is revoked. `resolvePrincipal` re-reads the user inside the
   * transaction; `undefined` rejects the refresh.
   */
  async rotate<TPrincipal extends { userId: string; tenantId: string }>(
    c: IApp,
    sessionId: string,
    resolvePrincipal: (
      tx: TDbOrTx,
      userId: string,
    ) => Promise<TPrincipal | undefined>,
  ): Promise<{ principal: TPrincipal; sessionId: string } | null> {
    const outcome = await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [old] = await tx
        .delete(SSession)
        .where(
          and(eq(SSession.id, sessionId), gt(SSession.expiresAt, c.nowDatetime)),
        )
        .returning({ userId: SSession.userId, familyId: SSession.familyId });

      if (!old) {
        const [reused] = await tx
          .select({ familyId: SRevokedRefreshToken.familyId })
          .from(SRevokedRefreshToken)
          .where(eq(SRevokedRefreshToken.sessionId, sessionId))
          .limit(1);
        if (!reused) {
          return { kind: "invalid" as const, revoked: [] };
        }
        const family = await tx
          .delete(SSession)
          .where(eq(SSession.familyId, reused.familyId))
          .returning({ id: SSession.id });
        return { kind: "reused" as const, revoked: family.map((r) => r.id) };
      }

      await tx.insert(SRevokedRefreshToken).values({
        sessionId,
        familyId: old.familyId,
        revokedAt: c.nowDatetime,
      });

      const principal = await resolvePrincipal(tx, old.userId);
      if (!principal) {
        return { kind: "invalid" as const, revoked: [] };
      }

      const [fresh] = await tx
        .insert(SSession)
        .values({
          userId: principal.userId,
          tenantId: principal.tenantId,
          familyId: old.familyId,
          createdAt: c.nowDatetime,
          expiresAt: new Date(
            c.nowDatetime.getTime() + 7 * 24 * 60 * 60 * 1000,
          ),
        })
        .returning({ id: SSession.id });

      return { kind: "rotated" as const, principal, sessionId: fresh.id };
    });

    await this.markRevoked([sessionId]);

    if (outcome.kind === "rotated") {
      return { principal: outcome.principal, sessionId: outcome.sessionId };
    }

    if (outcome.kind === "reused") {
      logger.warn(
        { sessionId, revokedSessions: outcome.revoked.length },
        "[ServiceSession] Refresh token reuse detected; token family revoked",
      );
      await this.markRevoked(outcome.revoked);
      for (const id of outcome.revoked) {
        WsManager.disconnectSession(id);
      }
    }
    return null;
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
