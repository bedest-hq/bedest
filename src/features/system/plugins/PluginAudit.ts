import { Elysia, type Context } from "elysia";
import ServiceSystemLog from "../services/ServiceSystemLog";
import { UtilAudit } from "@/common/utils/UtilAudit";
import { IUserApp } from "@/common/interfaces/IContextApp";

export const PluginAudit = new Elysia({ name: "PluginAudit" }).macro({
  audit(config: boolean | { action?: string; entity?: string }) {
    if (!config) {
      return {};
    }

    return {
      afterHandle({
        request,
        path,
        params,
        body,
        response,
        userRuntime,
      }: Context & {
        userRuntime?: IUserApp;
        response?: unknown;
      }) {
        if (!userRuntime || request.method === "GET") {
          return;
        }

        const isObject = typeof config === "object";
        const finalAction =
          isObject && config.action ? config.action : request.method;
        const finalEntity =
          isObject && config.entity
            ? config.entity
            : path.split("/")[3] || "system";

        let responseId: string | undefined;
        if (
          response &&
          typeof response === "object" &&
          "id" in response &&
          typeof response.id === "string"
        ) {
          responseId = response.id;
        }

        const entityId = params?.id ?? responseId ?? userRuntime.session.userId;
        const safePayload = UtilAudit.scrub(body) ?? {};

        void ServiceSystemLog.log(userRuntime, {
          action: finalAction,
          entity: finalEntity,
          entityId,
          payload: safePayload,
        });
      },
    };
  },
});
