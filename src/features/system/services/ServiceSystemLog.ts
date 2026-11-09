import { UtilHttp } from "@/common/utils/UtilHttp";
import { SSystemLog } from "../schemas/SSystemLog";
import { logger } from "@/infrastructure/logger/logger";
import { ITenantUserApp, TDb, TDbOrTx, UtilTenantScope } from "bedest-core";
import { and, count, desc, eq, SQL } from "drizzle-orm";

export const SYSTEM_AUDIT_USER_ID = "00000000-0000-0000-0000-000000000000";

class ServiceSystemLog {
  async log(
    c: ITenantUserApp,
    params: {
      action: string;
      entity: string;
      entityId: string | null;
      targetTenantId?: string | null;
      payload: Record<string, unknown>;
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
          targetTenantId: params.targetTenantId ?? null,
          payload: params.payload,
        });
      });
    } catch (err) {
      logger.error({ err, params }, "Audit Log insertion failed");
    }
  }

  async logEvent(
    db: TDb,
    params: {
      tenantId: string;
      userId?: string;
      action: string;
      entity: string;
      entityId: string | null;
      payload: Record<string, unknown>;
    },
  ) {
    try {
      // System events are written across tenants: system scope [BUG-01].
      await UtilTenantScope.systemScope(db, async (tx) => {
        await tx.insert(SSystemLog).values({
          tenantId: params.tenantId,
          userId: params.userId ?? SYSTEM_AUDIT_USER_ID,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          payload: params.payload,
        });
      });
    } catch (err) {
      logger.error({ err, params }, "Audit Log insertion failed");
    }
  }

  /**
   * Inserts a system event inside the caller's transaction. Unlike
   * `logEvent` it does not swallow errors, so the surrounding transaction
   * rolls back when the audit row cannot be written.
   */
  async insertEvent(
    tx: TDbOrTx,
    params: {
      tenantId: string;
      userId?: string;
      action: string;
      entity: string;
      entityId: string | null;
      payload: Record<string, unknown>;
    },
  ) {
    await tx.insert(SSystemLog).values({
      tenantId: params.tenantId,
      userId: params.userId ?? SYSTEM_AUDIT_USER_ID,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      payload: params.payload,
    });
  }

  async getAll(
    c: ITenantUserApp,
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
          targetTenantId: SSystemLog.targetTenantId,
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

  async getById(c: ITenantUserApp, id: string) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const [res] = await tx
        .select()
        .from(SSystemLog)
        .where(eq(SSystemLog.id, id))
        .limit(1);

      if (!res) {
        throw UtilHttp.fail(404);
      }

      return res;
    });
  }
}

export default new ServiceSystemLog();
