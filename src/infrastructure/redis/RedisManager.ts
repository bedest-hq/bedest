import Redis, { type RedisOptions } from "ioredis";
import { logger } from "../logger/logger";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export class RedisManager {
  private client: Redis | null = null;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private isConfigured: boolean = false;
  private isConnected: boolean = false;
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
      this.isConnected = false;
      return;
    }

    try {
      const options: RedisOptions = {
        maxRetriesPerRequest: 1,
        lazyConnect: false,
        enableOfflineQueue: false,
        retryStrategy: (times) => {
          if (times > 3) {
            return null;
          }
          return Math.min(times * 100, 2000);
        },
      };

      this.client = new Redis(redisUrl, options);
      this.publisher = new Redis(redisUrl, options);
      this.subscriber = new Redis(redisUrl, options);
      this.isConfigured = true;

      const handleErr = (name: string) => (err: Error) => {
        logger.warn(`[RedisManager] ${name} connection error: ${err.message}`);
        this.isConnected = false;
      };

      this.client.on("error", handleErr("client"));
      this.publisher.on("error", handleErr("publisher"));
      this.subscriber.on("error", handleErr("subscriber"));

      this.client.on("connect", () => {
        this.isConnected = true;
        logger.info("[RedisManager] Redis client connected");
      });

      this.setupSubscriberListeners(this.subscriber);
    } catch (err: unknown) {
      logger.warn(
        `[RedisManager] Initialization failed: ${getErrorMessage(err)}`,
      );
      this.cleanup();
    }
  }

  isAvailable(): boolean {
    if (!this.isConfigured || !this.client) {
      return false;
    }
    return (
      this.isConnected ||
      this.client.status === "ready" ||
      this.client.status === "connect"
    );
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

  async set(key: string, value: string): Promise<void> {
    if (!this.client || !this.isAvailable()) {
      return;
    }
    try {
      await this.client.set(key, value);
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

  async publish(channel: string, message: string): Promise<void> {
    if (!this.publisher || !this.isAvailable()) {
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

    if (isFirst && this.subscriber && this.isAvailable()) {
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

    if (isFirst && this.subscriber && this.isAvailable()) {
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
      if (this.subscriber && this.isAvailable()) {
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
      if (this.subscriber && this.isAvailable()) {
        try {
          await this.subscriber.punsubscribe(pattern);
        } catch {
          // ignore
        }
      }
    }
  }

  private setupSubscriberListeners(subscriber: Redis) {
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
    this.isConnected = true;

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
    this.isConnected = false;
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
