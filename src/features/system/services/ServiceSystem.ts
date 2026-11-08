import { eq } from "drizzle-orm";
import { IApp } from "bedest-core";
import RedisManager from "@/infrastructure/redis/RedisManager";
import { SSystemSetting } from "../schemas/SSystemSetting";

const MAINTENANCE_KEY = "maintenance_mode";
const INVALIDATE_CHANNEL = "system:settings:invalidate";

/**
 * Maintenance mode [BUG-08]: the database is the source of truth (shared by
 * every node), read through a short in-process cache; writes publish an
 * invalidation over Redis when available so other nodes refresh at once.
 */
export class ServiceSystem {
  private cache: { value: boolean; expiresAt: number } | undefined;

  constructor(
    private readonly ttlMs = 5000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Forget the cached value (Redis invalidation, tests). */
  invalidate() {
    this.cache = undefined;
  }

  /** Subscribe to invalidations published by other nodes. */
  async listen() {
    await RedisManager.subscribe(INVALIDATE_CHANNEL, () => this.invalidate());
  }

  async getMaintenance(c: IApp): Promise<boolean> {
    const now = this.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }
    const [row] = await c.db
      .select({ value: SSystemSetting.value })
      .from(SSystemSetting)
      .where(eq(SSystemSetting.key, MAINTENANCE_KEY))
      .limit(1);
    const value = row?.value === true;
    this.cache = { value, expiresAt: now + this.ttlMs };
    return value;
  }

  /** Persists the flag; a failed write propagates (500), never silently local. */
  async setMaintenance(c: IApp, status: boolean): Promise<void> {
    await c.db
      .insert(SSystemSetting)
      .values({ key: MAINTENANCE_KEY, value: status, updatedAt: c.nowDatetime })
      .onConflictDoUpdate({
        target: SSystemSetting.key,
        set: { value: status, updatedAt: c.nowDatetime },
      });
    this.cache = { value: status, expiresAt: this.now() + this.ttlMs };
    await RedisManager.publish(INVALIDATE_CHANNEL, MAINTENANCE_KEY);
  }
}

export default new ServiceSystem();
