import { Elysia } from "elysia";
import { logger } from "@/infrastructure/logger/logger";

import { UtilRequestId } from "@/common/utils/UtilRequestId";

/** userId and tenantId of the authenticated runtime, when the route has one. */
const runtimeIds = (ctx: object) => {
  if (!("userRuntime" in ctx)) {
    return {};
  }
  const rt: unknown = ctx.userRuntime;
  if (typeof rt !== "object" || rt === null) {
    return {};
  }
  const tenantId =
    "tenantId" in rt && typeof rt.tenantId === "string"
      ? rt.tenantId
      : undefined;
  const session: unknown = "session" in rt ? rt.session : undefined;
  const userId =
    typeof session === "object" &&
    session !== null &&
    "userId" in session &&
    typeof session.userId === "string"
      ? session.userId
      : undefined;
  return { userId, tenantId };
};

/**
 * Request ids and access logs [FEAT-04]:
 * - `x-request-id` is kept when it matches ^[A-Za-z0-9._-]{8,128}$,
 *   otherwise a UUID is generated; it is echoed in the response header;
 * - handlers get `requestId` and `log` (a child logger with the id);
 * - one `info` line per request: method, route pattern, status, duration,
 *   userId (and tenantId in bedest) — never bodies, cookies or the query.
 */
export const PluginRequestContext = new Elysia({ name: "PluginRequestContext" })
  .onRequest(({ request, set }) => {
    set.headers["x-request-id"] = UtilRequestId.begin(request).id;
  })
  .derive({ as: "global" }, ({ request }) => {
    const requestId =
      UtilRequestId.idOf(request) ?? UtilRequestId.begin(request).id;
    return { requestId, log: logger.child({ requestId }) };
  })
  .onAfterResponse({ as: "global" }, (ctx) => {
    const info = UtilRequestId.info(ctx.request);
    if (!info) {
      return;
    }
    logger.info(
      {
        requestId: info.id,
        method: ctx.request.method,
        route:
          typeof ctx.route === "string" && ctx.route ? ctx.route : "unmatched",
        status: typeof ctx.set.status === "number" ? ctx.set.status : 200,
        durationMs:
          Math.round((performance.now() - info.startedAt) * 100) / 100,
        ...runtimeIds(ctx),
      },
      "request",
    );
  });
