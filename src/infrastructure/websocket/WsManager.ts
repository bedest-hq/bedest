import RedisManager from "../redis/RedisManager";

interface IPublisher {
  publish(topic: string, data: string): void;
}

export interface IWsClient {
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

export class WsManager {
  private server: IPublisher | null = null;
  private userSockets = new Map<string, Set<IWsClient>>();
  private sessionSockets = new Map<string, Set<IWsClient>>();
  private redisHandler = (
    _pattern: string,
    channel: string,
    message: string,
  ) => {
    this.handleRedisMessage(channel, message);
  };

  init(server: IPublisher) {
    this.server = server;
    this.setupRedisSubscription();
  }

  setupRedisSubscription() {
    void RedisManager.psubscribe("events:*", this.redisHandler);
  }

  handleRedisMessage(channel: string, message: string) {
    if (channel.startsWith("events:tenant:")) {
      const tenantId = channel.slice("events:tenant:".length);
      this.server?.publish(`tenant:${tenantId}`, message);
    } else if (channel.startsWith("events:user:")) {
      const userId = channel.slice("events:user:".length);
      this.server?.publish(`user:${userId}`, message);
    } else if (channel.startsWith("events:disconnect:user:")) {
      const userId = channel.slice("events:disconnect:user:".length);
      this.disconnectUserLocal(userId);
    } else if (channel.startsWith("events:disconnect:session:")) {
      const sessionId = channel.slice("events:disconnect:session:".length);
      this.disconnectSessionLocal(sessionId);
    }
  }

  registerClient(userId: string, ws: IWsClient, sessionId?: string) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(ws);

    if (sessionId) {
      if (!this.sessionSockets.has(sessionId)) {
        this.sessionSockets.set(sessionId, new Set());
      }
      this.sessionSockets.get(sessionId)!.add(ws);
    }
  }

  unregisterClient(userId: string, ws: IWsClient, sessionId?: string) {
    const userSet = this.userSockets.get(userId);
    if (userSet) {
      userSet.delete(ws);
      if (userSet.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    if (sessionId) {
      const sessionSet = this.sessionSockets.get(sessionId);
      if (sessionSet) {
        sessionSet.delete(ws);
        if (sessionSet.size === 0) {
          this.sessionSockets.delete(sessionId);
        }
      }
    }
  }

  private disconnectUserLocal(userId: string) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) {
      return;
    }
    for (const ws of sockets) {
      try {
        ws.send({ event: "session_terminated" });
        ws.close(1008, "Session terminated");
      } catch {
        // ignore errors on already-closed sockets
      }
    }
    this.userSockets.delete(userId);
  }

  disconnectUser(userId: string) {
    this.disconnectUserLocal(userId);
    if (RedisManager.isAvailable()) {
      void RedisManager.publish(`events:disconnect:user:${userId}`, "terminated");
    }
  }

  private disconnectSessionLocal(sessionId: string) {
    const sockets = this.sessionSockets.get(sessionId);
    if (!sockets) {
      return;
    }
    for (const ws of sockets) {
      try {
        ws.send({ event: "session_terminated" });
        ws.close(1008, "Session terminated");
      } catch {
        // ignore errors on already-closed sockets
      }
    }
    this.sessionSockets.delete(sessionId);
  }

  disconnectSession(sessionId: string) {
    this.disconnectSessionLocal(sessionId);
    if (RedisManager.isAvailable()) {
      void RedisManager.publish(
        `events:disconnect:session:${sessionId}`,
        "terminated",
      );
    }
  }

  publishToUser(userId: string, event: string, payload?: unknown) {
    const data = JSON.stringify({ event, payload });
    if (RedisManager.isAvailable()) {
      void RedisManager.publish(`events:user:${userId}`, data);
    } else {
      this.server?.publish(`user:${userId}`, data);
    }
  }

  publishToTenant(tenantId: string, event: string, payload?: unknown) {
    const data = JSON.stringify({ event, payload });
    if (RedisManager.isAvailable()) {
      void RedisManager.publish(`events:tenant:${tenantId}`, data);
    } else {
      this.server?.publish(`tenant:${tenantId}`, data);
    }
  }
}

export default new WsManager();
