import { app } from "@/index";

class WsManager {
  publishToUser(userId: string, event: string, payload?: unknown) {
    app.server?.publish(`user:${userId}`, JSON.stringify({ event, payload }));
  }

  publishToTenant(tenantId: string, event: string, payload?: unknown) {
    app.server?.publish(
      `tenant:${tenantId}`,
      JSON.stringify({ event, payload }),
    );
  }
}

export default new WsManager();
