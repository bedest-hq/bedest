import { Elysia, type Context } from "elysia";
import { eq } from "drizzle-orm";
import ServiceSystemLog from "../services/ServiceSystemLog";
import { SUser } from "@f/user/schemas/SUser";
import { ITenantUserApp, UtilAudit, UtilTenantScope } from "bedest-core";

/**
 * Audit configuration of a route [BUG-11]. `entity` is required (no `true`
 * shorthand, no guessing from the URL). `targetTenant` says how to find
 * the tenant a SYSTEM actor changed: the entity id is a tenant ("entity")
 * or a user whose tenant is looked up ("user").
 */
export interface IAuditConf {
  entity: string;
  action?: string;
  targetTenant?: "entity" | "user";
}

/** The error-hook fields the audit reads [QLT-03]. */
interface IAuditErrorContext {
  code: unknown;
  error: unknown;
  set: { status?: number | string };
  request: Request;
  params?: unknown;
  body?: unknown;
  userRuntime?: ITenantUserApp;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** `v.id` when it is a UUID (the column type), otherwise undefined. */
const getId = (v: unknown) =>
  isObj(v) && typeof v.id === "string" && UUID_RE.test(v.id) ? v.id : undefined;

const getMeta = (body: unknown) => {
  if (!isObj(body)) {
    return { info: "[INVALID_BODY]" };
  }

  const meta: Record<string, unknown> = {};

  for (const k in body) {
    const v = body[k];

    if (v instanceof Blob) {
      const isFile = v instanceof File;
      meta[k] = {
        name: isFile ? v.name : "blob",
        ext:
          isFile && v.name.includes(".") ? v.name.split(".").pop() : "unknown",
        size: v.size,
        type: v.type,
      };
    }
  }

  return Object.keys(meta).length ? meta : { info: "[NO_FILE]" };
};

const statusOf = (c: IAuditErrorContext): number => {
  if (typeof c.set.status === "number" && c.set.status !== 500) {
    return c.set.status;
  }
  if (typeof c.code === "number") {
    return c.code;
  }
  if (isObj(c.error) && typeof c.error.code === "number") {
    return c.error.code;
  }
  if (isObj(c.error) && typeof c.error.status === "number") {
    return c.error.status;
  }
  return 500;
};

/** The tenant a SYSTEM actor changed, when the route declares how to find it. */
const resolveTargetTenant = async (
  rt: ITenantUserApp,
  cfg: IAuditConf,
  entityId: string | null,
): Promise<string | null> => {
  if (!rt.session.isSuperUser || !cfg.targetTenant || !entityId) {
    return null;
  }
  if (cfg.targetTenant === "entity") {
    return entityId;
  }
  const [user] = await UtilTenantScope.systemScope(rt.db, (tx) =>
    tx
      .select({ tenantId: SUser.tenantId })
      .from(SUser)
      .where(eq(SUser.id, entityId))
      .limit(1),
  );
  return user?.tenantId ?? null;
};

const write = async (
  rt: ITenantUserApp,
  cfg: IAuditConf,
  row: { action: string; entityId: string | null; payload: Record<string, unknown> },
) => {
  const targetTenantId = await resolveTargetTenant(rt, cfg, row.entityId);
  await ServiceSystemLog.log(rt, {
    action: row.action,
    entity: cfg.entity,
    entityId: row.entityId,
    targetTenantId,
    payload: row.payload,
  });
};

export const PluginAudit = new Elysia({ name: "PluginAudit" }).macro({
  audit(cfg: IAuditConf) {
    const onError = (c: IAuditErrorContext) => {
      if (!c.userRuntime || c.request.method === "GET") {
        return;
      }
      void write(c.userRuntime, cfg, {
        action: `FAILED_${c.request.method}`,
        entityId: getId(c.params) ?? null,
        payload: {
          error: c.error instanceof Error ? c.error.message : String(c.error),
          errorCode: c.code,
          statusCode: statusOf(c),
          body: UtilAudit.scrub(c.body),
        },
      });
    };

    return {
      afterResponse({
        request: { method, headers },
        params,
        body,
        response,
        userRuntime,
        set,
      }: Context & { userRuntime?: ITenantUserApp; response?: unknown }) {
        if (!userRuntime || method === "GET") {
          return;
        }

        const isMulti = headers.get("content-type")?.includes("multipart");
        const scrubbed = UtilAudit.scrub(body);
        const payloadData = isMulti
          ? getMeta(body)
          : isObj(scrubbed)
            ? scrubbed
            : {};

        void write(userRuntime, cfg, {
          action: cfg.action ?? method,
          // The URL's or the created entity's id, never the actor [BUG-11].
          entityId: getId(params) ?? getId(response) ?? null,
          payload: {
            statusCode: typeof set.status === "number" ? set.status : 200,
            ...payloadData,
          },
        });
      },
      error: onError,
    };
  },
});
