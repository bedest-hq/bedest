import { eq, lt, and, or, isNull, sql } from "drizzle-orm";
import type { IApp } from "bedest-core";
import RedisManager from "@/infrastructure/redis/RedisManager";
import { SLoginAttempt } from "../schemas/SLoginAttempt";

/** Failures allowed within the window before the account locks [FEAT-07]. */
export const LOCKOUT_MAX_FAILURES = 5;
/** Window in which failures are counted, and the lock duration. */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

const failKey = (hash: string) => `login:fail:${hash}`;
const lockKey = (hash: string) => `login:lock:${hash}`;

/**
 * SHA-256 hex of the normalized e-mail: counters and audit rows never
 * contain the address itself.
 */
export const emailHashOf = (normalizedEmail: string) =>
  new Bun.CryptoHasher("sha256").update(normalizedEmail).digest("hex");

/**
 * Account lockout [FEAT-07]: 5 failed logins for the same e-mail within
 * 15 min lock it for 15 min. Counters live in Redis when it is available,
 * otherwise in the login_attempts table.
 */
class ServiceLoginLockout {
  async isLocked(c: IApp, hash: string): Promise<boolean> {
    if (RedisManager.isAvailable()) {
      return (await RedisManager.get(lockKey(hash))) !== null;
    }
    const [row] = await c.db
      .select({ lockedUntil: SLoginAttempt.lockedUntil })
      .from(SLoginAttempt)
      .where(eq(SLoginAttempt.emailHash, hash))
      .limit(1);
    return row?.lockedUntil ? row.lockedUntil > c.nowDatetime : false;
  }

  /** Counts a failure; `lockedNow` is true when this failure locked it. */
  async recordFailure(c: IApp, hash: string): Promise<{ lockedNow: boolean }> {
    if (RedisManager.isAvailable()) {
      const counted = await RedisManager.incrementWindow(
        failKey(hash),
        LOCKOUT_WINDOW_MS,
      );
      if (counted) {
        if (counted.count >= LOCKOUT_MAX_FAILURES) {
          await RedisManager.set(lockKey(hash), "1", LOCKOUT_WINDOW_MS / 1000);
        }
        return { lockedNow: counted.count === LOCKOUT_MAX_FAILURES };
      }
    }

    const windowStart = new Date(c.nowDatetime.getTime() - LOCKOUT_WINDOW_MS);
    const lockedUntil = new Date(c.nowDatetime.getTime() + LOCKOUT_WINDOW_MS);
    return await c.db.transaction(async (tx) => {
      // A failure outside the window starts a new count.
      const [row] = await tx
        .insert(SLoginAttempt)
        .values({
          emailHash: hash,
          failures: 1,
          firstFailureAt: c.nowDatetime,
        })
        .onConflictDoUpdate({
          target: SLoginAttempt.emailHash,
          set: {
            failures: sql`CASE WHEN ${SLoginAttempt.firstFailureAt} < ${windowStart} THEN 1 ELSE ${SLoginAttempt.failures} + 1 END`,
            firstFailureAt: sql`CASE WHEN ${SLoginAttempt.firstFailureAt} < ${windowStart} THEN ${c.nowDatetime} ELSE ${SLoginAttempt.firstFailureAt} END`,
          },
        })
        .returning({ failures: SLoginAttempt.failures });
      if (!row || row.failures < LOCKOUT_MAX_FAILURES) {
        return { lockedNow: false };
      }
      await tx
        .update(SLoginAttempt)
        .set({ lockedUntil })
        .where(eq(SLoginAttempt.emailHash, hash));
      return { lockedNow: row.failures === LOCKOUT_MAX_FAILURES };
    });
  }

  /** A successful login clears the counters. */
  async reset(c: IApp, hash: string): Promise<void> {
    if (RedisManager.isAvailable()) {
      await RedisManager.del(failKey(hash));
      await RedisManager.del(lockKey(hash));
      return;
    }
    await c.db.delete(SLoginAttempt).where(eq(SLoginAttempt.emailHash, hash));
  }

  /** Job loginAttempts.cleanup [FEAT-08]: drop expired counters and locks. */
  async cleanup(c: IApp) {
    const windowStart = new Date(c.nowDatetime.getTime() - LOCKOUT_WINDOW_MS);
    const deleted = await c.db
      .delete(SLoginAttempt)
      .where(
        and(
          lt(SLoginAttempt.firstFailureAt, windowStart),
          or(
            isNull(SLoginAttempt.lockedUntil),
            lt(SLoginAttempt.lockedUntil, c.nowDatetime),
          ),
        ),
      )
      .returning({ hash: SLoginAttempt.emailHash });
    return { count: deleted.length };
  }
}

export default new ServiceLoginLockout();
