import WsManager from "@/infrastructure/websocket/WsManager";
import { SNotification } from "../schemas/SNotification";
import { UtilTenantScope } from "@/common/utils/UtilTenantScope";
import { IUserApp } from "@/common/interfaces/IContextApp";
import { and, count, desc, eq } from "drizzle-orm";
import { status } from "elysia";
import { logger } from "@/infrastructure/logger/logger";

class ServiceNotification {
  /**
   * Persist a notification for a specific user and push it over WebSocket.
   * Failures in either step are logged and swallowed — notifications are
   * best-effort and must never break the calling flow.
   */
  async sendToUser(
    c: IUserApp,
    targetUserId: string,
    event: string,
    payload?: Record<string, unknown>,
  ) {
    try {
      await UtilTenantScope.tenantScope(c, async (tx) => {
        await tx.insert(SNotification).values({
          tenantId: c.tenantId,
          userId: targetUserId,
          event,
          payload: payload ?? {},
          createdAt: c.nowDatetime,
        });
      });
    } catch (err) {
      logger.error(
        { err, targetUserId, event },
        "Failed to persist notification",
      );
    }

    WsManager.publishToUser(targetUserId, event, payload);
  }

  /**
   * Persist a broadcast notification for every connected user in the tenant
   * and push over the tenant WebSocket topic.
   * Per-user persistence is intentionally skipped for broadcasts — store only
   * a single tenant-scoped record using the sender's userId as the actor.
   */
  async sendToTenant(
    c: IUserApp,
    event: string,
    payload?: Record<string, unknown>,
  ) {
    try {
      await UtilTenantScope.tenantScope(c, async (tx) => {
        await tx.insert(SNotification).values({
          tenantId: c.tenantId,
          userId: c.session.userId,
          event,
          payload: payload ?? {},
          createdAt: c.nowDatetime,
        });
      });
    } catch (err) {
      logger.error(
        { err, tenantId: c.tenantId, event },
        "Failed to persist tenant notification",
      );
    }

    WsManager.publishToTenant(c.tenantId, event, payload);
  }

  async getAll(
    c: IUserApp,
    query: { limit: number; page: number; unreadOnly?: boolean },
  ) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const filters = [
        eq(SNotification.userId, c.session.userId),
        eq(SNotification.isDeleted, false),
      ];

      if (query.unreadOnly) {
        filters.push(eq(SNotification.isRead, false));
      }

      const [totalRes] = await tx
        .select({ count: count() })
        .from(SNotification)
        .where(and(...filters));

      const total = Number(totalRes.count);
      const offset = (query.page - 1) * query.limit;

      const data = await tx
        .select({
          id: SNotification.id,
          event: SNotification.event,
          payload: SNotification.payload,
          isRead: SNotification.isRead,
          readAt: SNotification.readAt,
          createdAt: SNotification.createdAt,
        })
        .from(SNotification)
        .where(and(...filters))
        .orderBy(desc(SNotification.createdAt))
        .limit(query.limit)
        .offset(offset);

      return {
        data,
        meta: {
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(total / query.limit),
        },
      };
    });
  }

  async markRead(c: IUserApp, id: string) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const [existing] = await tx
        .select({ userId: SNotification.userId })
        .from(SNotification)
        .where(
          and(eq(SNotification.id, id), eq(SNotification.isDeleted, false)),
        )
        .limit(1);

      if (!existing) {
        throw status("Not Found");
      }

      if (existing.userId !== c.session.userId) {
        throw status("Forbidden");
      }

      await tx
        .update(SNotification)
        .set({ isRead: true, readAt: c.nowDatetime })
        .where(eq(SNotification.id, id));

      return { success: true };
    });
  }

  async markAllRead(c: IUserApp) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      await tx
        .update(SNotification)
        .set({ isRead: true, readAt: c.nowDatetime })
        .where(
          and(
            eq(SNotification.userId, c.session.userId),
            eq(SNotification.isRead, false),
            eq(SNotification.isDeleted, false),
          ),
        );

      return { success: true };
    });
  }
}

export default new ServiceNotification();
