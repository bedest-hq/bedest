import Context from "@/app/Context";
import { Elysia, t } from "elysia";

export const RouterNotification = new Elysia({
  prefix: "/notifications",
  tags: ["Notification"],
})
  .use(Context.User())
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
