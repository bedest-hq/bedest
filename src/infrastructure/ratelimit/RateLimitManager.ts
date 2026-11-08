import {
  DefaultContext,
  rateLimit,
  type Context as IRateLimitContext,
  type Options as IRateLimitOptions,
} from "elysia-rate-limit";
import RedisManager from "../redis/RedisManager";

interface IRateLimitDerived {
  clientIp?: unknown;
  rateLimitEmail?: unknown;
}

export interface ILimiterOptions {
  /** Key namespace; also keeps buckets of different limiters apart. */
  name: string;
  /** Read on every request so limits follow the current configuration. */
  max: () => number;
  durationMs: number;
  key: (derived: { clientIp: string; rateLimitEmail: string }) => string;
}

/**
 * Store that counts in Redis when it is reachable (shared across nodes)
 * and falls back to process memory otherwise.
 */
export class RateLimitStore implements IRateLimitContext {
  private memory = new DefaultContext();
  private durationMs = 60_000;

  init(options: Omit<IRateLimitOptions, "context">) {
    this.memory.init(options);
    if (typeof options.duration === "number") {
      this.durationMs = options.duration;
    }
  }

  async increment(key: string, duration?: number, requestTime?: number) {
    const now = requestTime ?? Date.now();
    const windowMs = duration ?? this.durationMs;
    const remote = await RedisManager.incrementWindow(
      `ratelimit:${key}`,
      windowMs,
    );
    if (remote) {
      return {
        count: remote.count,
        nextReset: new Date(now + remote.ttlMs),
        start: now + remote.ttlMs - windowMs,
      };
    }
    return await this.memory.increment(key, windowMs, now);
  }

  async decrement(key: string) {
    if (!(await RedisManager.decrementWindow(`ratelimit:${key}`))) {
      await this.memory.decrement(key);
    }
  }

  async reset(key?: string) {
    if (typeof key === "string") {
      await RedisManager.del(`ratelimit:${key}`);
    }
    await this.memory.reset(key);
  }

  kill() {
    this.memory.kill();
  }
}

class RateLimitManager {
  private stores = new Set<RateLimitStore>();

  /**
   * A rate-limit plugin whose hooks apply only to the routes of the
   * instance that `.use()`s it (`scoping: "scoped"`). Failed requests are
   * counted, so failed logins consume the budget.
   */
  limiter(opts: ILimiterOptions) {
    const store = new RateLimitStore();
    this.stores.add(store);

    return rateLimit({
      scoping: "scoped",
      duration: opts.durationMs,
      // A function also gives each limiter a unique plugin seed, so two
      // limiters with equal numbers are never de-duplicated by Elysia.
      max: () => opts.max(),
      countFailedRequest: true,
      context: store,
      generator: (_request, _server, derived: IRateLimitDerived) =>
        `${opts.name}:${opts.key({
          clientIp:
            typeof derived.clientIp === "string" ? derived.clientIp : "unknown",
          rateLimitEmail:
            typeof derived.rateLimitEmail === "string"
              ? derived.rateLimitEmail
              : "",
        })}`,
      errorResponse: new Response(
        JSON.stringify({
          error: "Too Many Requests",
          message: "Rate limit exceeded, retry later",
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    });
  }

  /** Clears every bucket (used between tests). */
  async resetAll() {
    for (const store of this.stores) {
      await store.reset();
    }
  }
}

export default new RateLimitManager();
