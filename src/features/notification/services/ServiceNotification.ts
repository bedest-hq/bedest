import { UtilHttp } from "@/common/utils/UtilHttp";
import { SNotification, SNotificationRead } from "../schemas/SNotification";
import { and, count, desc, eq, or, sql } from "drizzle-orm";

import { ITenantUserApp, UtilTenantScope } from "bedest-core";

class ServiceNotification {
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
        throw UtilHttp.fail(404);
      }

      if (existing.isBroadcast) {
        if (existing.tenantId !== c.tenantId) {
          throw UtilHttp.fail(403);
        }

        // Idempotent under concurrency: the unique (user, notification)
        // index decides, not a prior SELECT [BUG-05].
        await tx
          .insert(SNotificationRead)
          .values({
            tenantId: c.tenantId,
            notificationId: id,
            userId: c.session.userId,
            readAt: c.nowDatetime,
          })
          .onConflictDoNothing();

        return { success: true };
      }

      if (existing.userId !== c.session.userId) {
        throw UtilHttp.fail(403);
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
        await tx
          .insert(SNotificationRead)
          .values(
            unreadBroadcasts.map((b) => ({
              tenantId: c.tenantId,
              notificationId: b.id,
              userId: c.session.userId,
              readAt: c.nowDatetime,
            })),
          )
          .onConflictDoNothing();
      }

      return { success: true };
    });
  }
}

export default new ServiceNotification();
