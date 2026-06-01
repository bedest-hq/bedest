interface IPublisher {
  publish(topic: string, data: string): void;
}

class WsManager {
  private server: IPublisher | null = null;

  init(server: IPublisher) {
    this.server = server;
  }

  publishToUser(userId: string, event: string, payload?: unknown) {
    this.server?.publish(`user:${userId}`, JSON.stringify({ event, payload }));
  }

  publishToTenant(tenantId: string, event: string, payload?: unknown) {
    this.server?.publish(
      `tenant:${tenantId}`,
      JSON.stringify({ event, payload }),
    );
  }
}

export default new WsManager();
