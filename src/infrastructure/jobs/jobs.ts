import { TEnv } from "@/common/types/TEnv";
import ServiceSession from "@f/session/services/ServiceSession";
import ServiceStorage from "@f/storage/services/ServiceStorage";
import ServiceNotification from "@f/notification/services/ServiceNotification";
import ServiceLoginLockout from "@f/auth/services/ServiceLoginLockout";
import ServiceUserToken from "@f/auth/services/ServiceUserToken";
import type { IJob } from "./JobScheduler";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const daysBefore = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS);

/** Rotated refresh-token ids are kept as long as a refresh token lives. */
const REVOKED_TOKEN_TTL_DAYS = 7;
/** A presigned upload not finalized within a day is abandoned. */
const PENDING_UPLOAD_TTL_MS = DAY_MS;

/** The background jobs of the application [FEAT-08]. */
export const createJobs = (
  env: Pick<TEnv, "STORAGE_PURGE_AFTER_DAYS" | "NOTIFICATION_RETENTION_DAYS">,
): IJob[] => [
  {
    name: "sessions.cleanupExpired",
    intervalMs: HOUR_MS,
    run: (c) => ServiceSession.cleanExpiredSessions(c),
  },
  {
    name: "storage.purgeDeleted",
    intervalMs: DAY_MS,
    run: (c) =>
      ServiceStorage.purgeDeleted(
        c,
        daysBefore(c.nowDatetime, env.STORAGE_PURGE_AFTER_DAYS),
      ),
  },
  {
    name: "storage.cleanupPending",
    intervalMs: HOUR_MS,
    run: (c) =>
      ServiceStorage.cleanupPending(
        c,
        new Date(c.nowDatetime.getTime() - PENDING_UPLOAD_TTL_MS),
      ),
  },
  {
    name: "tokens.cleanup",
    intervalMs: HOUR_MS,
    // Rotated refresh-token ids, and used or expired account tokens [FEAT-06].
    run: async (c) => ({
      revokedRefreshTokens: await ServiceSession.cleanupRevokedTokens(
        c,
        daysBefore(c.nowDatetime, REVOKED_TOKEN_TTL_DAYS),
      ),
      userTokens: await ServiceUserToken.cleanup(c),
    }),
  },
  {
    name: "notifications.retention",
    intervalMs: DAY_MS,
    run: (c) =>
      ServiceNotification.applyRetention(
        c,
        daysBefore(c.nowDatetime, env.NOTIFICATION_RETENTION_DAYS),
      ),
  },
  {
    // Expired counters of the DB-backed account lockout [FEAT-07].
    name: "loginAttempts.cleanup",
    intervalMs: HOUR_MS,
    run: (c) => ServiceLoginLockout.cleanup(c),
  },
];
