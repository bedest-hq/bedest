import Redis, { type RedisOptions } from "ioredis";
import { logger } from "../logger/logger";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

const INCREMENT_WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if count == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

const DECREMENT_WINDOW_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return redis.call("DECR", KEYS[1])
end
return 0
`;

/** Capped exponential backoff (100 ms, 200 ms, ... 10 s) that never gives up. */
export function redisRetryDelay(times: number): number {
  return Math.min(10_000, 100 * 2 ** Math.max(0, times - 1));
}

export class RedisManager {
  private client: Redis | null = null;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConfigured: boolean = false;
  private patternCallbacks: Map<
    string,
    Set<(pattern: string, channel: string, message: string) => void>
  > = new Map();
  private channelCallbacks: Map<
    string,
    Set<(channel: string, message: string) => void>
  > = new Map();

  init(redisUrl?: string) {
    if (!redisUrl) {
      this.isConfigured = false;
      return;
    }

    try {
      const options: RedisOptions = {
        maxRetriesPerRequest: 1,
        lazyConnect: false,
        enableOfflineQueue: false,
        // Never give up: a Redis outage must not disable Redis for the
        // lifetime of the process [BUG-09].
        retryStrategy: redisRetryDelay,
      };

      this.client = new Redis(redisUrl, options);
      this.publisher = new Redis(redisUrl, options);
      this.subscriber = new Redis(redisUrl, options);
      this.isConfigured = true;

      this.trackState("client", this.client);
      this.trackState("publisher", this.publisher);
      this.trackState("subscriber", this.subscriber);

      this.setupSubscriberListeners(this.subscriber);
    } catch (err: unknown) {
      logger.warn(
        `[RedisManager] Initialization failed: ${getErrorMessage(err)}`,
      );
      this.cleanup();
    }
  }

  /** Logs each connection's up/down transition once, not on every retry. */
  private trackState(name: string, connection: Redis) {
    let up = false;
    connection.on("ready", () => {
      if (!up) {
        up = true;
        logger.info(`[RedisManager] ${name} connected`);
      }
    });
    const down = (reason: string) => {
      if (up) {
        up = false;
        logger.warn(`[RedisManager] ${name} connection lost (${reason}); retrying`);
      }
    };
    connection.on("error", (err: Error) => down(err.message));
    connection.on("close", () => down("closed"));
  }

  /** The command connection (GET/SET/EVAL) is usable. */
  isAvailable(): boolean {
    return this.isConfigured && this.client?.status === "ready";
  }

  isPublisherReady(): boolean {
    return this.isConfigured && this.publisher?.status === "ready";
  }

  isSubscriberReady(): boolean {
    return this.isConfigured && this.subscriber?.status === "ready";
  }

  /** Whether REDIS_URL was configured (regardless of current health). */
  isEnabled(): boolean {
    return this.isConfigured;
  }

  /** PING with a timeout; false when unreachable or not configured. */
  async ping(timeoutMs = 2000): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        this.client.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("ping timeout")), timeoutMs);
        }),
      ]);
      return reply === "PONG";
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isAvailable()) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (err: unknown) {
      logger.warn(`[RedisManager] get(${key}) error: ${getErrorMessage(err)}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (!this.client || !this.isAvailable()) {
      return;
    }
    try {
      if (ttlSec !== undefined) {
        await this.client.set(key, value, "EX", ttlSec);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: unknown) {
      logger.warn(`[RedisManager] set(${key}) error: ${getErrorMessage(err)}`);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client || !this.isAvailable()) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (err: unknown) {
      logger.warn(`[RedisManager] del(${key}) error: ${getErrorMessage(err)}`);
    }
  }

  /**
   * Atomically increments a fixed-window counter and returns the new count
   * and the remaining window in ms. `null` when Redis is unavailable, so the
   * caller can fall back to a local counter.
   */
  async incrementWindow(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; ttlMs: number } | null> {
    if (!this.client || !this.isAvailable()) {
      return null;
    }
    try {
      const res: unknown = await this.client.eval(
        INCREMENT_WINDOW_SCRIPT,
        1,
        key,
        String(windowMs),
      );
      if (
        Array.isArray(res) &&
        typeof res[0] === "number" &&
        typeof res[1] === "number"
      ) {
        return { count: res[0], ttlMs: res[1] };
      }
      return null;
    } catch (err: unknown) {
      logger.warn(
        `[RedisManager] incrementWindow(${key}) error: ${getErrorMessage(err)}`,
      );
      return null;
    }
  }

  /** Decrements a counter created by `incrementWindow`; false when unavailable. */
  async decrementWindow(key: string): Promise<boolean> {
    if (!this.client || !this.isAvailable()) {
      return false;
    }
    try {
      await this.client.eval(DECREMENT_WINDOW_SCRIPT, 1, key);
      return true;
    } catch (err: unknown) {
      logger.warn(
        `[RedisManager] decrementWindow(${key}) error: ${getErrorMessage(err)}`,
      );
      return false;
    }
  }

  async publish(channel: string, message: string): Promise<void> {
    if (!this.publisher || !this.isPublisherReady()) {
      return;
    }
    try {
      await this.publisher.publish(channel, message);
    } catch (err: unknown) {
      logger.warn(
        `[RedisManager] publish(${channel}) error: ${getErrorMessage(err)}`,
      );
    }
  }

  async subscribe(
    channel: string,
    callback: (channel: string, message: string) => void,
  ): Promise<void> {
    let isFirst = false;
    if (!this.channelCallbacks.has(channel)) {
      this.channelCallbacks.set(channel, new Set());
      isFirst = true;
    }
    this.channelCallbacks.get(channel)!.add(callback);

    if (isFirst && this.subscriber && this.isSubscriberReady()) {
      try {
        await this.subscriber.subscribe(channel);
      } catch (err: unknown) {
        logger.warn(
          `[RedisManager] subscribe(${channel}) error: ${getErrorMessage(err)}`,
        );
      }
    }
  }

  async psubscribe(
    pattern: string,
    callback: (pattern: string, channel: string, message: string) => void,
  ): Promise<void> {
    let isFirst = false;
    if (!this.patternCallbacks.has(pattern)) {
      this.patternCallbacks.set(pattern, new Set());
      isFirst = true;
    }
    this.patternCallbacks.get(pattern)!.add(callback);

    if (isFirst && this.subscriber && this.isSubscriberReady()) {
      try {
        await this.subscriber.psubscribe(pattern);
      } catch (err: unknown) {
        logger.warn(
          `[RedisManager] psubscribe(${pattern}) error: ${getErrorMessage(err)}`,
        );
      }
    }
  }

  async unsubscribe(
    channel: string,
    callback?: (channel: string, message: string) => void,
  ): Promise<void> {
    const callbacks = this.channelCallbacks.get(channel);
    if (!callbacks) {
      return;
    }

    if (callback) {
      callbacks.delete(callback);
    } else {
      callbacks.clear();
    }

    if (callbacks.size === 0) {
      this.channelCallbacks.delete(channel);
      if (this.subscriber && this.isSubscriberReady()) {
        try {
          await this.subscriber.unsubscribe(channel);
        } catch {
          // ignore
        }
      }
    }
  }

  async punsubscribe(
    pattern: string,
    callback?: (pattern: string, channel: string, message: string) => void,
  ): Promise<void> {
    const callbacks = this.patternCallbacks.get(pattern);
    if (!callbacks) {
      return;
    }

    if (callback) {
      callbacks.delete(callback);
    } else {
      callbacks.clear();
    }

    if (callbacks.size === 0) {
      this.patternCallbacks.delete(pattern);
      if (this.subscriber && this.isSubscriberReady()) {
        try {
          await this.subscriber.punsubscribe(pattern);
        } catch {
          // ignore
        }
      }
    }
  }

  /** Re-issues every registered subscription (after (re)connecting). */
  private async resubscribe() {
    if (!this.subscriber) {
      return;
    }
    try {
      for (const channel of this.channelCallbacks.keys()) {
        await this.subscriber.subscribe(channel);
      }
      for (const pattern of this.patternCallbacks.keys()) {
        await this.subscriber.psubscribe(pattern);
      }
    } catch (err: unknown) {
      logger.warn(
        `[RedisManager] re-subscribe failed: ${getErrorMessage(err)}`,
      );
    }
  }

  private setupSubscriberListeners(subscriber: Redis) {
    // Subscriptions registered while the connection was down were never
    // sent: re-issue all of them whenever the subscriber is ready [BUG-09].
    subscriber.on("ready", () => {
      void this.resubscribe();
    });
    subscriber.on("message", (channel: string, message: string) => {
      const callbacks = this.channelCallbacks.get(channel);
      if (callbacks) {
        callbacks.forEach((cb) => {
          try {
            cb(channel, message);
          } catch (err: unknown) {
            logger.error(
              `[RedisManager] Message callback error on ${channel}: ${getErrorMessage(err)}`,
            );
          }
        });
      }
    });

    subscriber.on(
      "pmessage",
      (pattern: string, channel: string, message: string) => {
        const callbacks = this.patternCallbacks.get(pattern);
        if (callbacks) {
          callbacks.forEach((cb) => {
            try {
              cb(pattern, channel, message);
            } catch (err: unknown) {
              logger.error(
                `[RedisManager] Pmessage callback error on ${pattern} (${channel}): ${getErrorMessage(err)}`,
              );
            }
          });
        }
      },
    );
  }

  setClientsForTesting(client: unknown, publisher: unknown, subscriber: unknown) {
    this.client = client as Redis;
    this.publisher = publisher as Redis;
    this.subscriber = subscriber as Redis;
    this.isConfigured = true;

    if (this.subscriber) {
      this.setupSubscriberListeners(this.subscriber);
      for (const pattern of this.patternCallbacks.keys()) {
        try {
          void this.subscriber.psubscribe?.(pattern);
        } catch {
          // ignore
        }
      }
      for (const channel of this.channelCallbacks.keys()) {
        try {
          void this.subscriber.subscribe?.(channel);
        } catch {
          // ignore
        }
      }
    }
  }

  private cleanup() {
    this.client = null;
    this.publisher = null;
    this.subscriber = null;
    this.isConfigured = false;
    this.channelCallbacks.clear();
    this.patternCallbacks.clear();
  }

  async close(): Promise<void> {
    try {
      if (this.subscriber) {
        await this.subscriber.quit();
      }
      if (this.publisher) {
        await this.publisher.quit();
      }
      if (this.client) {
        await this.client.quit();
      }
    } catch {
      this.subscriber?.disconnect();
      this.publisher?.disconnect();
      this.client?.disconnect();
    } finally {
      this.cleanup();
    }
  }
}

export default new RedisManager();
