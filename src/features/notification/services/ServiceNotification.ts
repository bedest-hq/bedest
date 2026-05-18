import WsManager from "@/infrastructure/websocket/WsManager";

class ServiceNotification {
  async sendToUser(userId: string, event: string, payload?: unknown) {
    WsManager.publishToUser(userId, event, payload);
  }

  async sendToTenant(tenantId: string, event: string, payload?: unknown) {
    WsManager.publishToTenant(tenantId, event, payload);
  }
}

export default new ServiceNotification();
