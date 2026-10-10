import WsManager from "@/infrastructure/websocket/WsManager";
import { SNotification, SNotificationRead } from "../schemas/SNotification";
import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { status } from "elysia";
import { logger } from "@/infrastructure/logger/logger";
import { ITenantUserApp, UtilTenantScope } from "bedest-core";

class ServiceNotification {
  /**
   * Persist a notification for a specific user and push it over WebSocket.
   * Failures in either step are logged and swallowed — notifications are
   * best-effort and must never break the calling flow.
   */
  async sendToUser(
    c: ITenantUserApp,
    targetUserId: string,
    event: string,
    payload?: Record<string, unknown>,
  ) {
    try {
      await UtilTenantScope.tenantScope(c, async (tx) => {
        await tx.insert(SNotification).values({
          tenantId: c.tenantId,
          userId: targetUserId,
          isBroadcast: false,
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
   * a single tenant-scoped record with userId null and isBroadcast true.
   */
  async sendToTenant(
    c: ITenantUserApp,
    event: string,
    payload?: Record<string, unknown>,
  ) {
    try {
      await UtilTenantScope.tenantScope(c, async (tx) => {
        await tx.insert(SNotification).values({
          tenantId: c.tenantId,
          userId: null,
          isBroadcast: true,
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
    c: ITenantUserApp,
    query: { limit: number; page: number; unreadOnly?: boolean },
  ) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const readJoinCondition = and(
        eq(SNotificationRead.notificationId, SNotification.id),
        eq(SNotificationRead.userId, c.session.userId),
      );

      const baseVisibility = and(
        eq(SNotification.isDeleted, false),
        or(
          eq(SNotification.userId, c.session.userId),
          and(
            eq(SNotification.tenantId, c.tenantId),
            eq(SNotification.isBroadcast, true),
          ),
        ),
      );

      const isReadExpr = sql<boolean>`CASE WHEN ${SNotification.isBroadcast} THEN ${SNotificationRead.id} IS NOT NULL ELSE ${SNotification.isRead} END`;
      const readAtExpr = sql<Date | null>`CASE WHEN ${SNotification.isBroadcast} THEN ${SNotificationRead.readAt} ELSE ${SNotification.readAt} END`;

      const unreadFilter = query.unreadOnly
        ? sql`(CASE WHEN ${SNotification.isBroadcast} THEN ${SNotificationRead.id} IS NULL ELSE ${SNotification.isRead} = false END)`
        : undefined;

      const whereClause = unreadFilter
        ? and(baseVisibility, unreadFilter)
        : baseVisibility;

      const [totalRes] = await tx
        .select({ count: count() })
        .from(SNotification)
        .leftJoin(SNotificationRead, readJoinCondition)
        .where(whereClause);

      const total = Number(totalRes.count);
      const offset = (query.page - 1) * query.limit;

      const data = await tx
        .select({
          id: SNotification.id,
          event: SNotification.event,
          payload: SNotification.payload,
          isRead: isReadExpr,
          readAt: readAtExpr,
          createdAt: SNotification.createdAt,
        })
        .from(SNotification)
        .leftJoin(SNotificationRead, readJoinCondition)
        .where(whereClause)
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

  async markRead(c: ITenantUserApp, id: string) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const [existing] = await tx
        .select({
          userId: SNotification.userId,
          isBroadcast: SNotification.isBroadcast,
          tenantId: SNotification.tenantId,
        })
        .from(SNotification)
        .where(
          and(eq(SNotification.id, id), eq(SNotification.isDeleted, false)),
        )
        .limit(1);

      if (!existing) {
        throw status("Not Found");
      }

      if (existing.isBroadcast) {
        if (existing.tenantId !== c.tenantId) {
          throw status("Forbidden");
        }

        const [alreadyRead] = await tx
          .select({ id: SNotificationRead.id })
          .from(SNotificationRead)
          .where(
            and(
              eq(SNotificationRead.notificationId, id),
              eq(SNotificationRead.userId, c.session.userId),
            ),
          )
          .limit(1);

        if (!alreadyRead) {
          await tx.insert(SNotificationRead).values({
            tenantId: c.tenantId,
            notificationId: id,
            userId: c.session.userId,
            readAt: c.nowDatetime,
          });
        }

        return { success: true };
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

  async markAllRead(c: ITenantUserApp) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      // 1. Mark personal unread notifications
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

      // 2. Mark unread broadcast notifications by inserting into SNotificationRead
      const unreadBroadcasts = await tx
        .select({ id: SNotification.id })
        .from(SNotification)
        .leftJoin(
          SNotificationRead,
          and(
            eq(SNotificationRead.notificationId, SNotification.id),
            eq(SNotificationRead.userId, c.session.userId),
          ),
        )
        .where(
          and(
            eq(SNotification.tenantId, c.tenantId),
            eq(SNotification.isBroadcast, true),
            eq(SNotification.isDeleted, false),
            sql`${SNotificationRead.id} IS NULL`,
          ),
        );

      if (unreadBroadcasts.length > 0) {
        await tx.insert(SNotificationRead).values(
          unreadBroadcasts.map((b) => ({
            tenantId: c.tenantId,
            notificationId: b.id,
            userId: c.session.userId,
            readAt: c.nowDatetime,
          })),
        );
      }

      return { success: true };
    });
  }
}

export default new ServiceNotification();
