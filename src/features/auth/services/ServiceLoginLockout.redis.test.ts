import { describe, it, expect, afterEach } from "bun:test";
import { EventEmitter } from "node:events";
import { eq } from "drizzle-orm";
import { test_db, test_runtime_db } from "@/common/tests/TestManager.test";
import RedisManager from "@/infrastructure/redis/RedisManager";
import { SLoginAttempt } from "../schemas/SLoginAttempt";
import ServiceLoginLockout, {
  emailHashOf,
  LOCKOUT_MAX_FAILURES,
} from "./ServiceLoginLockout";

/** In-memory stand-in for the ioredis client (external I/O). */
class FakeRedis extends EventEmitter {
  status = "ready";
  values = new Map<string, string>();
  counters = new Map<string, number>();

  eval(script: string, _keys: number, key: string, windowMs?: string) {
    const count = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, count);
    return Promise.resolve([count, Number(windowMs ?? 0)]);
  }

  get(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve("OK");
  }

  del(key: string) {
    this.values.delete(key);
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

const c = { db: test_runtime_db, nowDatetime: new Date() };

describe("FEAT-07: lockout counters in Redis (bedest)", () => {
  afterEach(async () => {
    await RedisManager.close();
  });

  it("[FEAT-07] with Redis available the counters and the lock live in Redis, not the table", async () => {
    const redis = new FakeRedis();
    RedisManager.setClientsForTesting(redis, new FakeRedis(), new FakeRedis());
    const hash = emailHashOf(`redis_${crypto.randomUUID()}@example.com`);

    let lockedNow = false;
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
      ({ lockedNow } = await ServiceLoginLockout.recordFailure(c, hash));
    }
    expect(lockedNow).toBe(true);
    expect(await ServiceLoginLockout.isLocked(c, hash)).toBe(true);
    expect(redis.values.get(`login:lock:${hash}`)).toBe("1");
    const rows = await test_db
      .select()
      .from(SLoginAttempt)
      .where(eq(SLoginAttempt.emailHash, hash));
    expect(rows).toEqual([]);

    await ServiceLoginLockout.reset(c, hash);
    expect(await ServiceLoginLockout.isLocked(c, hash)).toBe(false);
  });
});
