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

/**
 * Requests already audited. With the global ErrorHandler a failure only
 * reaches afterResponse; without it only the route error hook runs, so
 * both hooks write and this set keeps it to one row per request.
 */
const audited = new WeakSet<Request>();

/** Status of a failed request seen by the error hook. */
const statusOf = (c: IAuditErrorContext): number => {
  if (isObj(c.error) && typeof c.error.code === "number") {
    return c.error.code;
  }
  if (typeof c.code === "number") {
    return c.code;
  }
  return typeof c.set.status === "number" && c.set.status >= 400
    ? c.set.status
    : 500;
};

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

/** The text of an error envelope (message, else reason phrase). */
const errorText = (body: unknown): string | undefined => {
  if (!isObj(body)) {
    return undefined;
  }
  if (typeof body.message === "string") {
    return body.message;
  }
  return typeof body.error === "string" ? body.error : undefined;
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
  row: {
    action: string;
    entityId: string | null;
    payload: Record<string, unknown>;
  },
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
      const { request } = c;
      if (!c.userRuntime || request.method === "GET" || audited.has(request)) {
        return;
      }
      audited.add(c.request);
      void write(c.userRuntime, cfg, {
        action: `FAILED_${c.request.method}`,
        entityId: getId(c.params) ?? null,
        payload: {
          statusCode: statusOf(c),
          error:
            c.error instanceof Error
              ? c.error.message
              : errorText(isObj(c.error) ? c.error.response : undefined),
          body: UtilAudit.scrub(c.body),
        },
      });
    };

    return {
      afterResponse({
        request,
        params,
        body,
        responseValue,
        userRuntime,
        set,
      }: Context & { userRuntime?: ITenantUserApp; responseValue?: unknown }) {
        const { method, headers } = request;
        if (!userRuntime || method === "GET" || audited.has(request)) {
          return;
        }
        audited.add(request);

        const isMulti = headers.get("content-type")?.includes("multipart");
        const scrubbed = UtilAudit.scrub(body);
        const payloadData = isMulti
          ? getMeta(body)
          : isObj(scrubbed)
            ? scrubbed
            : {};

        const statusCode = typeof set.status === "number" ? set.status : 200;
        const failed = statusCode >= 400;
        const error = failed ? errorText(responseValue) : undefined;

        void write(userRuntime, cfg, {
          action: failed ? `FAILED_${method}` : (cfg.action ?? method),
          // The URL's or the created entity's id, never the actor [BUG-11].
          entityId:
            getId(params) ??
            (failed ? undefined : getId(responseValue)) ??
            null,
          payload: {
            statusCode,
            ...(error === undefined ? {} : { error }),
            ...payloadData,
          },
        });
      },
      error: onError,
    };
  },
});
