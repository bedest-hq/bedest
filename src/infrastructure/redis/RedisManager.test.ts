import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import RedisManager, { redisRetryDelay } from "./RedisManager";
import WsManager, { IWsClient } from "../websocket/WsManager";
import ServiceSystem from "@/features/system/services/ServiceSystem";
import DbManager from "@/infrastructure/database/DbManager";
import { EventEmitter } from "events";

class MockRedisClient extends EventEmitter {
  store = new Map<string, string>();
  status = "ready";

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return Promise.resolve("OK");
  }

  del(key: string): Promise<number> {
    this.store.delete(key);
    return Promise.resolve(1);
  }

  quit(): Promise<string> {
    this.status = "end";
    return Promise.resolve("OK");
  }

  disconnect() {
    this.status = "end";
  }
}

class MockPubSubHub {
  subscribers: Set<MockRedisPubSub> = new Set();

  register(client: MockRedisPubSub) {
    this.subscribers.add(client);
  }

  unregister(client: MockRedisPubSub) {
    this.subscribers.delete(client);
  }

  publish(channel: string, message: string) {
    for (const sub of this.subscribers) {
      sub.receiveMessage(channel, message);
    }
  }
}

class MockRedisPubSub extends EventEmitter {
  hub: MockPubSubHub;
  patterns = new Set<string>();
  channels = new Set<string>();
  status = "ready";

  constructor(hub: MockPubSubHub) {
    super();
    this.hub = hub;
    this.hub.register(this);
  }

  publish(channel: string, message: string): Promise<number> {
    this.hub.publish(channel, message);
    return Promise.resolve(1);
  }

  subscribe(channel: string): Promise<string> {
    this.channels.add(channel);
    return Promise.resolve("OK");
  }

  psubscribe(pattern: string): Promise<string> {
    this.patterns.add(pattern);
    return Promise.resolve("OK");
  }

  unsubscribe(channel: string): Promise<string> {
    this.channels.delete(channel);
    return Promise.resolve("OK");
  }

  punsubscribe(pattern: string): Promise<string> {
    this.patterns.delete(pattern);
    return Promise.resolve("OK");
  }

  receiveMessage(channel: string, message: string) {
    if (this.channels.has(channel)) {
      this.emit("message", channel, message);
    }
    for (const pattern of this.patterns) {
      if (pattern === "events:*" && channel.startsWith("events:")) {
        this.emit("pmessage", pattern, channel, message);
      }
    }
  }

  quit(): Promise<string> {
    this.hub.unregister(this);
    return Promise.resolve("OK");
  }

  disconnect() {
    this.hub.unregister(this);
  }
}

describe("RedisManager & Distributed WebSocket State", () => {
  let mockClient: MockRedisClient;
  let hub: MockPubSubHub;
  let mockPub: MockRedisPubSub;
  let mockSub: MockRedisPubSub;

  beforeEach(() => {
    mockClient = new MockRedisClient();
    hub = new MockPubSubHub();
    mockPub = new MockRedisPubSub(hub);
    mockSub = new MockRedisPubSub(hub);

    RedisManager.setClientsForTesting(mockClient, mockPub, mockSub);
  });

  afterEach(async () => {
    await RedisManager.close();
  });

  it("[BUG-08] Distributed Maintenance Mode: the database is the source of truth and writes publish an invalidation", async () => {
    expect(RedisManager.isAvailable()).toBe(true);
    const c = { db: DbManager.get(), nowDatetime: new Date() };
    const published: string[] = [];
    mockSub.on("message", (channel: string) => published.push(channel));
    await RedisManager.subscribe("system:settings:invalidate", () => {});

    expect(await ServiceSystem.getMaintenance(c)).toBe(false);
    await ServiceSystem.setMaintenance(c, true);
    expect(await ServiceSystem.getMaintenance(c)).toBe(true);
    expect(published).toContain("system:settings:invalidate");

    await ServiceSystem.setMaintenance(c, false);
    expect(await ServiceSystem.getMaintenance(c)).toBe(false);
  });

  it("Distributed WebSocket: Multi-node event broadcasting via Redis pub/sub", async () => {
    // Node A (publisher) and Node B (subscriber)
    const nodeBPublished: { topic: string; data: string }[] = [];
    const mockNodeBServer = {
      publish: (topic: string, data: string) => {
        nodeBPublished.push({ topic, data });
      },
    };

    // Initialize WsManager on Node B
    WsManager.init(mockNodeBServer);

    // Node A publishes to tenant T1
    WsManager.publishToTenant("tenant-123", "invoice.created", { amount: 500 });
    await new Promise((r) => setTimeout(r, 20));

    // Node B should receive the event via Redis channel
    expect(nodeBPublished.length).toBe(1);
    expect(nodeBPublished[0].topic).toBe("tenant:tenant-123");
    const parsed = JSON.parse(nodeBPublished[0].data);
    expect(parsed.event).toBe("invoice.created");
    expect(parsed.payload).toEqual({ amount: 500 });
  });

  it("Distributed WebSocket: Cluster-wide session termination across nodes", () => {
    let closedCode: number | undefined;
    let closedReason: string | undefined;
    const sentMessages: unknown[] = [];

    // The registry keys sockets by connection id [BUG-10].
    const mockClientWs: IWsClient = {
      id: crypto.randomUUID(),
      send: (msg) => {
        sentMessages.push(msg);
      },
      close: (code, reason) => {
        closedCode = code;
        closedReason = reason;
      },
    };

    // Client connects to Node B
    WsManager.registerClient(mockClientWs, {
      userId: "user-456",
      sessionId: "session-789",
      expiresAt: Date.now() + 60_000,
    });

    // Another node calls disconnectUser
    WsManager.disconnectUser("user-456");

    // Client socket on Node B should be disconnected
    expect(closedCode).toBe(1008);
    expect(closedReason).toBe("Session terminated");
    expect(sentMessages).toContainEqual({ event: "session_terminated" });
  });

  it("Graceful fallback when Redis is unconfigured or unavailable", async () => {
    // Close redis
    await RedisManager.close();
    expect(RedisManager.isAvailable()).toBe(false);

    // [BUG-08] Maintenance mode still works: the database is the source.
    const c = { db: DbManager.get(), nowDatetime: new Date() };
    await ServiceSystem.setMaintenance(c, true);
    expect(await ServiceSystem.getMaintenance(c)).toBe(true);

    await ServiceSystem.setMaintenance(c, false);
    expect(await ServiceSystem.getMaintenance(c)).toBe(false);

    // WebSocket publishes locally when server is available
    const localBroadcasts: { topic: string; data: string }[] = [];
    WsManager.init({
      publish: (topic, data) => {
        localBroadcasts.push({ topic, data });
      },
    });

    WsManager.publishToTenant("tenant-fallback", "ping", {});
    expect(localBroadcasts.length).toBe(1);
    expect(localBroadcasts[0].topic).toBe("tenant:tenant-fallback");
  });
});

describe("BUG-09: RedisManager recovery", () => {
  afterEach(async () => {
    await RedisManager.close();
  });

  it("[BUG-09] retries forever with capped exponential backoff (never gives up)", () => {
    const delays = [1, 2, 3, 4, 5, 8, 20, 1000].map((t) => redisRetryDelay(t));
    expect(delays.every((d) => typeof d === "number" && d > 0)).toBe(true);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(Math.max(...delays)).toBe(10_000);
  });

  it("[BUG-09] a pattern registered while the subscriber is down is subscribed on ready and receives messages", async () => {
    const hub = new MockPubSubHub();
    const client = new MockRedisClient();
    const pub = new MockRedisPubSub(hub);
    const sub = new MockRedisPubSub(hub);
    RedisManager.setClientsForTesting(client, pub, sub);

    // The subscriber connection drops.
    sub.status = "reconnecting";
    sub.patterns.clear();
    const received: string[] = [];
    await RedisManager.psubscribe("events:*", (_p, channel) =>
      received.push(channel),
    );
    expect(sub.patterns.has("events:*")).toBe(false);
    expect(RedisManager.isSubscriberReady()).toBe(false);
    expect(RedisManager.isPublisherReady()).toBe(true);

    // It comes back: registered patterns are re-issued.
    sub.status = "ready";
    sub.emit("ready");
    await Bun.sleep(1);
    expect(sub.patterns.has("events:*")).toBe(true);

    await pub.publish("events:user:1", "hello");
    expect(received).toEqual(["events:user:1"]);
  });
});
