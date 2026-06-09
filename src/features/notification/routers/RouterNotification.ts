import Context from "@/app/Context";
import { Elysia, t } from "elysia";
import ServiceNotification from "../services/ServiceNotification";
import { UtilRouter, VId, VQuery } from "bedest-core";

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
        }),
      ]),
      response: UtilRouter.defPaginatedSchema(
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
    body: t.Object({
      event: t.Literal("ping"),
    }),
    open(ws) {
      const { userRuntime } = ws.data;
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
      ws.unsubscribe(`tenant:${userRuntime.tenantId}`);
      ws.unsubscribe(`user:${userRuntime.session.userId}`);
    },
  });
