import { Elysia, type Context } from "elysia";
import ServiceSystemLog from "../services/ServiceSystemLog";
import { UtilAudit } from "@/common/utils/UtilAudit";
import { IUserApp } from "@/common/interfaces/IContextApp";

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

    return {
      afterHandle({
        request: { method, headers, url },
        path,
        params,
        body,
        response,
        userRuntime,
      }: Context & { userRuntime?: IUserApp; response?: unknown }) {
        if (!userRuntime || method === "GET") {
          return;
        }

        const p = typeof path === "string" ? path : new URL(url).pathname;
        const isMulti = headers.get("content-type")?.includes("multipart");

        void ServiceSystemLog.log(userRuntime, {
          action: cfg.action || method,
          entity: cfg.entity || p.split("/")[3] || "system",
          entityId:
            getId(params) || getId(response) || userRuntime.session.userId,
          payload: isMulti ? getMeta(body) : (UtilAudit.scrub(body) ?? {}),
        });
      },
    };
  },
});
