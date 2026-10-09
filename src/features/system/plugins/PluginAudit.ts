import { Elysia, type Context } from "elysia";
import ServiceSystemLog from "../services/ServiceSystemLog";
import { ITenantUserApp, UtilAudit } from "bedest-core";

type AuditConf = boolean | { action?: string; entity?: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const getId = (v: unknown) =>
  isObj(v) && typeof v.id === "string" ? v.id : undefined;

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

export const PluginAudit = new Elysia({ name: "PluginAudit" }).macro({
  audit(conf: AuditConf) {
    if (!conf) {
      return {};
    }

    const cfg = typeof conf === "object" ? conf : {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorHandler = (c: any) => {
      const {
        code,
        error,
        set,
        request,
        userRuntime,
        path,
        params,
        body,
      } = c;
      if (!userRuntime || request.method === "GET") {
        return;
      }
      const status =
        typeof set?.status === "number" && set.status !== 500
          ? set.status
          : typeof code === "number"
            ? code
            : typeof (error as { status?: number })?.status === "number"
              ? (error as { status?: number }).status!
              : typeof set?.status === "number"
                ? set.status
                : 500;
      const p =
        typeof path === "string" ? path : new URL(request.url).pathname;
      void ServiceSystemLog.log(userRuntime, {
        action: `FAILED_${request.method}`,
        entity: cfg.entity || p.split("/")[3] || "system",
        entityId: getId(params) || userRuntime.session.userId,
        payload: {
          error: error instanceof Error ? error.message : String(error),
          errorCode: code,
          statusCode: status,
          body: UtilAudit.scrub(body),
        },
      });
    };

    return {
      afterResponse({
        request: { method, headers, url },
        path,
        params,
        body,
        response,
        userRuntime,
        set,
      }: Context & { userRuntime?: ITenantUserApp; response?: unknown }) {
        if (!userRuntime || method === "GET") {
          return;
        }

        const p = typeof path === "string" ? path : new URL(url).pathname;
        const isMulti = headers.get("content-type")?.includes("multipart");
        const status = typeof set.status === "number" ? set.status : 200;
        const scrubbed = UtilAudit.scrub(body);
        const payloadData = isMulti
          ? getMeta(body)
          : isObj(scrubbed)
            ? scrubbed
            : {};

        void ServiceSystemLog.log(userRuntime, {
          action: cfg.action || method,
          entity: cfg.entity || p.split("/")[3] || "system",
          entityId:
            getId(params) || getId(response) || userRuntime.session.userId,
          payload: {
            statusCode: status,
            ...payloadData,
          },
        });
      },
      error: errorHandler,
    };
  },
});
