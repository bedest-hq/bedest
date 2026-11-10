import { describe, it, expect, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import RedisManager from "./RedisManager";

/** In-memory stand-in for one ioredis connection (external I/O). */
class FakeConnection extends EventEmitter {
  status = "ready";
  channels = new Set<string>();
  patterns = new Set<string>();
  pingReply: () => Promise<string> = () => Promise.resolve("PONG");

  ping() {
    return this.pingReply();
  }
  subscribe(channel: string) {
    this.channels.add(channel);
    return Promise.resolve(1);
  }
  unsubscribe(channel: string) {
    this.channels.delete(channel);
    return Promise.resolve(0);
  }
  psubscribe(pattern: string) {
    this.patterns.add(pattern);
    return Promise.resolve(1);
  }
  punsubscribe(pattern: string) {
    this.patterns.delete(pattern);
    return Promise.resolve(0);
  }
  quit() {
    this.status = "end";
    return Promise.resolve("OK");
  }
  disconnect() {
    this.status = "end";
  }
}

const connect = () => {
  const [client, publisher, subscriber] = [
    new FakeConnection(),
    new FakeConnection(),
    new FakeConnection(),
  ];
  RedisManager.setClientsForTesting(client, publisher, subscriber);
  return { client, subscriber };
};

afterEach(async () => {
  await RedisManager.close();
});

describe("RedisManager connection lifecycle", () => {
  it("[BUG-09] without REDIS_URL Redis is disabled and ping is false", async () => {
    RedisManager.init(undefined);
    expect(RedisManager.isEnabled()).toBe(false);
    expect(RedisManager.isAvailable()).toBe(false);
    expect(await RedisManager.ping()).toBe(false);
  });

  it("[OPS-02] ping is true on PONG, false on an error or after the timeout", async () => {
    const { client } = connect();
    expect(await RedisManager.ping()).toBe(true);

    client.pingReply = () => Promise.reject(new Error("connection lost"));
    expect(await RedisManager.ping()).toBe(false);

    client.pingReply = () => new Promise<string>(() => undefined);
    expect(await RedisManager.ping(10)).toBe(false);
  });

  it("[BUG-10] a channel is unsubscribed only when its last callback goes", async () => {
    const { subscriber } = connect();
    const received: string[] = [];
    const a = (_: string, message: string) => received.push(`a:${message}`);
    const b = (_: string, message: string) => received.push(`b:${message}`);
    await RedisManager.subscribe("events:x", a);
    await RedisManager.subscribe("events:x", b);
    expect(subscriber.channels.has("events:x")).toBe(true);

    await RedisManager.unsubscribe("events:x", a);
    expect(subscriber.channels.has("events:x")).toBe(true);
    subscriber.emit("message", "events:x", "1");
    expect(received).toEqual(["b:1"]);

    await RedisManager.unsubscribe("events:x");
    expect(subscriber.channels.has("events:x")).toBe(false);
    subscriber.emit("message", "events:x", "2");
    expect(received).toEqual(["b:1"]);
    // Unknown channels are a no-op.
    await RedisManager.unsubscribe("events:none");
  });

  it("[BUG-10] a pattern is unsubscribed only when its last callback goes", async () => {
    const { subscriber } = connect();
    const received: string[] = [];
    const a = (_p: string, _c: string, message: string) =>
      received.push(`a:${message}`);
    const b = (_p: string, _c: string, message: string) =>
      received.push(`b:${message}`);
    await RedisManager.psubscribe("events:*", a);
    await RedisManager.psubscribe("events:*", b);
    expect(subscriber.patterns.has("events:*")).toBe(true);

    await RedisManager.punsubscribe("events:*", a);
    expect(subscriber.patterns.has("events:*")).toBe(true);
    subscriber.emit("pmessage", "events:*", "events:y", "1");
    expect(received).toEqual(["b:1"]);

    await RedisManager.punsubscribe("events:*");
    expect(subscriber.patterns.has("events:*")).toBe(false);
    await RedisManager.punsubscribe("events:none");
  });
});
