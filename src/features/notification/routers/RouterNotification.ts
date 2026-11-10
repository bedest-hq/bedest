import Context from "@/app/Context";
import { Elysia, t } from "elysia";
import ServiceNotification from "../services/ServiceNotification";
import { VId, VQuery } from "bedest-core";
import { VCursor, VCursorPage } from "@/common/validations/VPagination";
import WsManager from "@/infrastructure/websocket/WsManager";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilOrigin } from "@/app/plugins/UtilOrigin";

export const RouterNotification = new Elysia({
  prefix: "/notifications",
  tags: ["Notification"],
})
  .use(Context.User())

  // REST

  .get(
    "/",
    async ({ query, userRuntime }) => {
      return await ServiceNotification.getAll(userRuntime, query);
    },
    {
      query: t.Composite([
        VQuery,
        t.Object({
          unreadOnly: t.Optional(t.BooleanString()),
          // Keyset pagination; page is ignored when set [PERF-02].
          cursor: VCursor,
        }),
      ]),
      response: VCursorPage(
        t.Object({
          id: VId,
          event: t.String(),
          payload: t.Record(t.String(), t.Unknown()),
          isRead: t.Boolean(),
          readAt: t.Nullable(t.Date()),
          createdAt: t.Date(),
        }),
      ),
    },
  )

  .patch(
    "/:id/read",
    async ({ params, userRuntime }) => {
      return await ServiceNotification.markRead(userRuntime, params.id);
    },
    {
      params: t.Object({ id: VId }),
      response: t.Object({ success: t.Boolean() }),
    },
  )

  .patch(
    "/read-all",
    async ({ userRuntime }) => {
      return await ServiceNotification.markAllRead(userRuntime);
    },
    {
      response: t.Object({ success: t.Boolean() }),
    },
  )

  // WebSocket

  .ws("/live", {
    // Cross-site WebSocket hijacking protection [SEC-18]: in production the
    // upgrade is refused unless Origin is one of CORS_ORIGINS.
    beforeHandle({ request, set }) {
      const env = EnvManager.get();
      if (
        env.NODE_ENV === "production" &&
        !UtilOrigin.isAllowed(request.headers.get("origin"), env)
      ) {
        set.status = 403;
        return "Forbidden";
      }
    },
    body: t.Object({
      event: t.Literal("ping"),
    }),
    open(ws) {
      const { userRuntime, accessTokenExpiresAt } = ws.data;
      // Keyed by the connection id; closed on revocation or token expiry
      // [BUG-10].
      WsManager.registerClient(ws, {
        userId: userRuntime.session.userId,
        sessionId: userRuntime.session.sessionId,
        expiresAt: accessTokenExpiresAt,
      });
      ws.subscribe(`tenant:${userRuntime.tenantId}`);
      ws.subscribe(`user:${userRuntime.session.userId}`);
      ws.send({ event: "connected" });
    },
    message(ws, message) {
      if (message.event === "ping") {
        ws.send({ event: "pong" });
      }
    },
    close(ws) {
      const { userRuntime } = ws.data;
      WsManager.unregisterClient(ws);
      ws.unsubscribe(`tenant:${userRuntime.tenantId}`);
      ws.unsubscribe(`user:${userRuntime.session.userId}`);
    },
  });
