import RedisManager from "../redis/RedisManager";

interface IPublisher {
  publish(topic: string, data: string): void;
}

/**
 * A socket as the registry sees it. Elysia creates a new wrapper object for
 * every event of the same connection, so `id` (stable per connection) is
 * the key, never object identity [BUG-10].
 */
export interface IWsClient {
  readonly id: string;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

export interface IWsClientInfo {
  userId: string;
  sessionId: string;
  /** Access token expiry (ms since epoch): the socket is closed after it. */
  expiresAt: number;
}

interface IWsEntry extends IWsClientInfo {
  ws: IWsClient;
}

export interface IWsManagerDeps {
  now?: () => number;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every?: (fn: () => void, ms: number) => () => void;
}

/** Interval of the expired-token sweep [BUG-10]. */
export const WS_SWEEP_INTERVAL_MS = 30_000;
/** Close code for a socket whose access token expired; the client refreshes and reconnects. */
export const WS_TOKEN_EXPIRED = 4001;

const defaultEvery = (fn: () => void, ms: number) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export class WsManager {
  private server: IPublisher | null = null;
  private readonly clients = new Map<string, IWsEntry>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly bySession = new Map<string, Set<string>>();
  private readonly now: () => number;
  private readonly every: (fn: () => void, ms: number) => () => void;
  private stopSweep: (() => void) | null = null;
  private redisHandler = (
    _pattern: string,
    channel: string,
    message: string,
  ) => {
    this.handleRedisMessage(channel, message);
  };

  constructor(deps: IWsManagerDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.every = deps.every ?? defaultEvery;
  }

  init(server: IPublisher) {
    this.server = server;
    this.setupRedisSubscription();
    this.stopSweep?.();
    this.stopSweep = this.every(() => this.sweepExpired(), WS_SWEEP_INTERVAL_MS);
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

  registerClient(ws: IWsClient, info: IWsClientInfo) {
    this.remove(ws.id);
    this.clients.set(ws.id, { ws, ...info });
    this.index(this.byUser, info.userId).add(ws.id);
    this.index(this.bySession, info.sessionId).add(ws.id);
  }

  /** Accepts any wrapper of the connection (matched by `id`). */
  unregisterClient(ws: IWsClient) {
    this.remove(ws.id);
  }

  /** Registry sizes, for tests and diagnostics. */
  stats() {
    return {
      clients: this.clients.size,
      users: this.byUser.size,
      sessions: this.bySession.size,
    };
  }

  private index(map: Map<string, Set<string>>, key: string) {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }

  private unindex(map: Map<string, Set<string>>, key: string, id: string) {
    const set = map.get(key);
    if (!set) {
      return;
    }
    set.delete(id);
    if (set.size === 0) {
      map.delete(key);
    }
  }

  /** Removes a connection from the registry and from every index. */
  private remove(id: string): IWsEntry | undefined {
    const entry = this.clients.get(id);
    if (!entry) {
      return undefined;
    }
    this.clients.delete(id);
    this.unindex(this.byUser, entry.userId, id);
    this.unindex(this.bySession, entry.sessionId, id);
    return entry;
  }

  private terminate(ids: Iterable<string>, event: string, code: number, reason: string) {
    for (const id of [...ids]) {
      const entry = this.remove(id);
      if (!entry) {
        continue;
      }
      try {
        entry.ws.send({ event });
        entry.ws.close(code, reason);
      } catch {
        // ignore errors on already-closed sockets
      }
    }
  }

  /** Closes every socket whose access token has expired [BUG-10]. */
  sweepExpired() {
    const now = this.now();
    const expired = [...this.clients.values()]
      .filter((entry) => entry.expiresAt <= now)
      .map((entry) => entry.ws.id);
    this.terminate(expired, "token_expired", WS_TOKEN_EXPIRED, "Token expired");
  }

  private disconnectUserLocal(userId: string) {
    this.terminate(
      this.byUser.get(userId) ?? [],
      "session_terminated",
      1008,
      "Session terminated",
    );
  }

  disconnectUser(userId: string) {
    this.disconnectUserLocal(userId);
    if (RedisManager.isPublisherReady()) {
      void RedisManager.publish(`events:disconnect:user:${userId}`, "terminated");
    }
  }

  private disconnectSessionLocal(sessionId: string) {
    this.terminate(
      this.bySession.get(sessionId) ?? [],
      "session_terminated",
      1008,
      "Session terminated",
    );
  }

  disconnectSession(sessionId: string) {
    this.disconnectSessionLocal(sessionId);
    if (RedisManager.isPublisherReady()) {
      void RedisManager.publish(
        `events:disconnect:session:${sessionId}`,
        "terminated",
      );
    }
  }

  /** Closes every local socket (graceful shutdown uses 1001 "Going Away"). */
  closeAll(code = 1001, reason = "Server shutting down") {
    this.stopSweep?.();
    this.stopSweep = null;
    for (const entry of [...this.clients.values()]) {
      this.remove(entry.ws.id);
      try {
        entry.ws.close(code, reason);
      } catch {
        // ignore errors on already-closed sockets
      }
    }
  }

  publishToUser(userId: string, event: string, payload?: unknown) {
    const data = JSON.stringify({ event, payload });
    if (RedisManager.isPublisherReady()) {
      void RedisManager.publish(`events:user:${userId}`, data);
    } else {
      this.server?.publish(`user:${userId}`, data);
    }
  }

  publishToTenant(tenantId: string, event: string, payload?: unknown) {
    const data = JSON.stringify({ event, payload });
    if (RedisManager.isPublisherReady()) {
      void RedisManager.publish(`events:tenant:${tenantId}`, data);
    } else {
      this.server?.publish(`tenant:${tenantId}`, data);
    }
  }
}

export default new WsManager();
