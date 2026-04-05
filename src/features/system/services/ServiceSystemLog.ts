import { IUserApp } from "@/common/interfaces/IContextApp";
import { SSystemLog } from "../schemas/SSystemLog";
import { UtilTenantScope } from "@/common/utils/UtilTenantScope";
import { logger } from "@/infrastructure/logger/logger";
import { and, count, desc, eq, SQL } from "drizzle-orm";
import { status } from "elysia";

class ServiceSystemLog {
  async log(
    c: IUserApp,
    params: {
      action: string;
      entity: string;
      entityId: string;
      payload: unknown;
    },
  ) {
    try {
      await UtilTenantScope.tenantScope(c, async (tx) => {
        await tx.insert(SSystemLog).values({
          tenantId: c.tenantId,
          userId: c.session.userId,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          payload: params.payload as Record<string, unknown>,
        });
      });
    } catch (err) {
      logger.error({ err, params }, "Audit Log insertion failed");
    }
  }

  async getAll(
    c: IUserApp,
    query: {
      limit: number;
      page: number;
      action?: string;
      entity?: string;
      entityId?: string;
      userId?: string;
    },
  ) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const filters: SQL<unknown>[] = [];

      if (query.action) {
        filters.push(eq(SSystemLog.action, query.action));
      }
      if (query.entity) {
        filters.push(eq(SSystemLog.entity, query.entity));
      }
      if (query.entityId) {
        filters.push(eq(SSystemLog.entityId, query.entityId));
      }
      if (query.userId) {
        filters.push(eq(SSystemLog.userId, query.userId));
      }

      const [totalRes] = await tx
        .select({ count: count() })
        .from(SSystemLog)
        .where(and(...filters));

      const total = Number(totalRes.count);
      const offset = (query.page - 1) * query.limit;

      const data = await tx
        .select({
          id: SSystemLog.id,
          userId: SSystemLog.userId,
          action: SSystemLog.action,
          entity: SSystemLog.entity,
          entityId: SSystemLog.entityId,
          payload: SSystemLog.payload,
          createdAt: SSystemLog.createdAt,
        })
        .from(SSystemLog)
        .where(and(...filters))
        .orderBy(desc(SSystemLog.createdAt))
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

  async getById(c: IUserApp, id: string) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const [res] = await tx
        .select()
        .from(SSystemLog)
        .where(eq(SSystemLog.id, id))
        .limit(1);

      if (!res) {
        throw status("Not Found");
      }

      return res;
    });
  }
}

export default new ServiceSystemLog();
