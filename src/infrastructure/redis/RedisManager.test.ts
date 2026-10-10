import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import RedisManager from "./RedisManager";
import WsManager, { IWsClient } from "../websocket/WsManager";
import ServiceSystem from "@/features/system/services/ServiceSystem";
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

  it("Distributed Maintenance Mode: get and set maintenance status via Redis key", async () => {
    expect(RedisManager.isAvailable()).toBe(true);

    expect(await ServiceSystem.getMaintenance()).toBe(false);

    await ServiceSystem.setMaintenance(true);
    expect(await ServiceSystem.getMaintenance()).toBe(true);
    expect(await mockClient.get("system:maintenance_mode")).toBe("true");

    await ServiceSystem.setMaintenance(false);
    expect(await ServiceSystem.getMaintenance()).toBe(false);
    expect(await mockClient.get("system:maintenance_mode")).toBe("false");
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

    const mockClientWs: IWsClient = {
      send: (msg) => {
        sentMessages.push(msg);
      },
      close: (code, reason) => {
        closedCode = code;
        closedReason = reason;
      },
    };

    // Client connects to Node B
    WsManager.registerClient("user-456", mockClientWs, "session-789");

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

    // Maintenance mode still works in-memory
    await ServiceSystem.setMaintenance(true);
    expect(await ServiceSystem.getMaintenance()).toBe(true);

    await ServiceSystem.setMaintenance(false);
    expect(await ServiceSystem.getMaintenance()).toBe(false);

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
