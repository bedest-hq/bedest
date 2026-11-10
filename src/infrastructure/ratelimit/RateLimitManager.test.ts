import { describe, it, expect, afterEach } from "bun:test";
import { EventEmitter } from "events";
import RedisManager from "../redis/RedisManager";
import { RateLimitStore } from "./RateLimitManager";
import { UtilClientIp } from "./UtilClientIp";

/** Minimal stand-in for the ioredis client: only the Redis network is faked. */
class FakeRedis extends EventEmitter {
  status = "ready";
  counters = new Map<string, number>();
  ttl = new Map<string, number>();

  eval(script: string, _keys: number, key: string, windowMs?: string) {
    if (script.includes("INCR")) {
      const count = (this.counters.get(key) ?? 0) + 1;
      this.counters.set(key, count);
      if (count === 1) {
        this.ttl.set(key, Number(windowMs));
      }
      return Promise.resolve([count, this.ttl.get(key) ?? 0]);
    }
    const current = this.counters.get(key);
    if (current !== undefined) {
      this.counters.set(key, current - 1);
    }
    return Promise.resolve(current === undefined ? 0 : current - 1);
  }

  del(key: string) {
    this.counters.delete(key);
    return Promise.resolve(1);
  }

  quit() {
    this.status = "end";
    return Promise.resolve("OK");
  }

  disconnect() {
    this.status = "end";
  }
}

const options = {
  duration: 60_000,
  max: 5,
  errorResponse: "",
  scoping: "scoped" as const,
  countFailedRequest: true,
  generator: () => "",
  skip: () => false,
  headers: true,
};

describe("RateLimitStore", () => {
  afterEach(async () => {
    await RedisManager.close();
  });

  it("[SEC-07] counts in Redis when it is available (shared across nodes)", async () => {
    const redis = new FakeRedis();
    RedisManager.setClientsForTesting(redis, new FakeRedis(), new FakeRedis());

    const nodeA = new RateLimitStore();
    const nodeB = new RateLimitStore();
    nodeA.init(options);
    nodeB.init(options);

    expect((await nodeA.increment("login:ip:1.2.3.4")).count).toBe(1);
    const second = await nodeB.increment("login:ip:1.2.3.4");
    expect(second.count).toBe(2);
    expect(redis.counters.get("ratelimit:login:ip:1.2.3.4")).toBe(2);
    expect(second.nextReset.getTime()).toBeGreaterThan(Date.now());

    await nodeA.decrement("login:ip:1.2.3.4");
    expect(redis.counters.get("ratelimit:login:ip:1.2.3.4")).toBe(1);
  });

  it("[SEC-07] falls back to process memory when Redis is unavailable", async () => {
    const store = new RateLimitStore();
    store.init(options);

    expect((await store.increment("k")).count).toBe(1);
    expect((await store.increment("k")).count).toBe(2);
    await store.reset();
    expect((await store.increment("k")).count).toBe(1);
  });
});

describe("UtilClientIp", () => {
  const server = { requestIP: () => ({ address: "192.0.2.10" }) };
  const req = (xff?: string) =>
    new Request("http://localhost/", {
      headers: xff ? { "x-forwarded-for": xff } : {},
    });

  it("[SEC-07] ignores X-Forwarded-For when no proxy is trusted", () => {
    expect(UtilClientIp.resolve(req("203.0.113.1"), server, 0)).toBe(
      "192.0.2.10",
    );
  });

  it("[SEC-07] takes the entry at position -hops when proxies are trusted", () => {
    expect(UtilClientIp.resolve(req("1.1.1.1, 2.2.2.2"), server, 1)).toBe(
      "2.2.2.2",
    );
    expect(
      UtilClientIp.resolve(req("1.1.1.1, 2.2.2.2, 3.3.3.3"), server, 2),
    ).toBe("2.2.2.2");
    // Fewer entries than trusted hops → the socket address.
    expect(UtilClientIp.resolve(req("2.2.2.2"), server, 3)).toBe("192.0.2.10");
    expect(UtilClientIp.resolve(req(), null, 1)).toBe("unknown");
  });
});
