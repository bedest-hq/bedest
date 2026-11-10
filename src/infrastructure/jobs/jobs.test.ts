import { describe, it, expect, spyOn, mock } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import {
  test_db,
  test_env,
  test_runtime_db,
  test_tenant,
  test_user,
} from "@/common/tests/TestManager.test";
import { SSession } from "@f/session/schemas/SSession";
import { SRevokedRefreshToken } from "@f/session/schemas/SRevokedRefreshToken";
import { SStorage } from "@f/storage/schemas/SStorage";
import { EStorageStatus } from "@f/storage/enums/EStorageStatus";
import { SNotification } from "@f/notification/schemas/SNotification";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SUserToken } from "@f/auth/schemas/SUserToken";
import { EUserTokenType } from "@f/auth/enums/EUserTokenType";
import { tokenHashOf } from "@f/auth/services/ServiceUserToken";
import { JobScheduler } from "./JobScheduler";
import { createJobs } from "./jobs";
import { SLoginAttempt } from "@f/auth/schemas/SLoginAttempt";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

const NOW = new Date("2026-06-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** The real jobs, run as the application role (RLS on, system scope). */
const scheduler = () => {
  const s = new JobScheduler({
    db: () => test_runtime_db,
    lock: () => Promise.resolve(() => Promise.resolve()),
    now: () => NOW,
  });
  for (const j of createJobs(test_env)) {
    s.register(j);
  }
  return s;
};

const insertFile = async (values: {
  status?: EStorageStatus;
  isDeleted?: boolean;
  deletedAt?: Date;
  createdAt?: Date;
}) => {
  const [row] = await test_db
    .insert(SStorage)
    .values({
      tenantId: test_tenant.id,
      name: "f.png",
      key: `${test_tenant.id}/${crypto.randomUUID()}.png`,
      mimeType: "image/png",
      size: 1,
      status: values.status ?? EStorageStatus.READY,
      isDeleted: values.isDeleted ?? false,
      deletedAt: values.deletedAt,
      createdAt: values.createdAt ?? NOW,
    })
    .returning({ id: SStorage.id, key: SStorage.key });
  return row;
};

const fileIds = async (ids: string[]) =>
  (
    await test_db
      .select({ id: SStorage.id })
      .from(SStorage)
      .where(inArray(SStorage.id, ids))
  )
    .map((r) => r.id)
    .sort();

describe("FEAT-08: jobs", () => {
  it("[FEAT-08] registers the specified jobs", () => {
    expect(scheduler().names()).toEqual([
      "sessions.cleanupExpired",
      "storage.purgeDeleted",
      "storage.cleanupPending",
      "tokens.cleanup",
      "notifications.retention",
      "loginAttempts.cleanup",
    ]);
  });

  it("[FEAT-08][QLT-05] sessions.cleanupExpired deletes expired sessions only", async () => {
    const [expired, valid] = await test_db
      .insert(SSession)
      .values([
        {
          userId: test_user.id,
          tenantId: test_tenant.id,
          createdAt: ago(9 * DAY),
          expiresAt: ago(DAY),
        },
        {
          userId: test_user.id,
          tenantId: test_tenant.id,
          createdAt: ago(DAY),
          expiresAt: new Date(NOW.getTime() + DAY),
        },
      ])
      .returning({ id: SSession.id });

    expect(await scheduler().runOnce("sessions.cleanupExpired")).toMatchObject({
      status: "done",
    });
    const left = await test_db
      .select({ id: SSession.id })
      .from(SSession)
      .where(inArray(SSession.id, [expired.id, valid.id]));
    expect(left).toEqual([{ id: valid.id }]);
  });

  it("[FEAT-08] storage.purgeDeleted removes old unreferenced files (object, then row)", async () => {
    const del = spyOn(StorageManager.default, "delete").mockImplementation(
      mock(() => Promise.resolve()),
    );
    del.mockClear();
    const old = await insertFile({ isDeleted: true, deletedAt: ago(31 * DAY) });
    const recent = await insertFile({ isDeleted: true, deletedAt: ago(DAY) });
    const referenced = await insertFile({
      isDeleted: true,
      deletedAt: ago(40 * DAY),
    });
    // A soft-deleted user still references it (FK): the row must stay.
    await test_db.insert(SUser).values({
      name: "Gone",
      email: `gone_${crypto.randomUUID().slice(0, 8)}@example.com`,
      tenantId: test_tenant.id,
      password: "x",
      role: EUserRole.USER,
      avatarId: referenced.id,
      isDeleted: true,
      deletedAt: ago(40 * DAY),
    });

    expect(await scheduler().runOnce("storage.purgeDeleted")).toEqual({
      status: "done",
      result: { purged: 1 },
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0]?.[0]).toBe(old.key);
    expect(await fileIds([old.id, recent.id, referenced.id])).toEqual(
      [recent.id, referenced.id].sort(),
    );
    del.mockRestore();
  });

  it("[FEAT-08] storage.purgeDeleted keeps the row when the object delete fails", async () => {
    const del = spyOn(StorageManager.default, "delete").mockImplementation(() =>
      Promise.reject(new Error("S3 unavailable")),
    );
    const old = await insertFile({ isDeleted: true, deletedAt: ago(31 * DAY) });
    expect(await scheduler().runOnce("storage.purgeDeleted")).toEqual({
      status: "done",
      result: { purged: 0 },
    });
    expect(await fileIds([old.id])).toEqual([old.id]);
    del.mockRestore();
  });

  it("[FEAT-08] storage.cleanupPending removes uploads still PENDING after 24 h", async () => {
    const del = spyOn(StorageManager.default, "delete").mockImplementation(
      mock(() => Promise.resolve()),
    );
    del.mockClear();
    const stale = await insertFile({
      status: EStorageStatus.PENDING,
      createdAt: ago(25 * 60 * 60 * 1000),
    });
    const fresh = await insertFile({
      status: EStorageStatus.PENDING,
      createdAt: ago(60 * 60 * 1000),
    });
    const ready = await insertFile({ createdAt: ago(10 * DAY) });

    expect(await scheduler().runOnce("storage.cleanupPending")).toEqual({
      status: "done",
      result: { removed: 1 },
    });
    expect(del.mock.calls.map((c) => c[0])).toEqual([stale.key]);
    expect(await fileIds([stale.id, fresh.id, ready.id])).toEqual(
      [fresh.id, ready.id].sort(),
    );
    del.mockRestore();
  });

  it("[FEAT-08] tokens.cleanup drops rotated refresh-token ids older than 7 days", async () => {
    const oldId = crypto.randomUUID();
    const newId = crypto.randomUUID();
    await test_db.insert(SRevokedRefreshToken).values([
      { sessionId: oldId, familyId: oldId, revokedAt: ago(8 * DAY) },
      { sessionId: newId, familyId: newId, revokedAt: ago(DAY) },
    ]);

    await scheduler().runOnce("tokens.cleanup");
    const left = await test_db
      .select({ id: SRevokedRefreshToken.sessionId })
      .from(SRevokedRefreshToken)
      .where(inArray(SRevokedRefreshToken.sessionId, [oldId, newId]));
    expect(left).toEqual([{ id: newId }]);
  });

  it("[FEAT-06][FEAT-08] tokens.cleanup also deletes used and expired account tokens, keeping valid ones", async () => {
    const token = (expiresAt: Date, usedAt: Date | null) => ({
      userId: test_user.id,
      tenantId: test_tenant.id,
      type: EUserTokenType.PASSWORD_RESET,
      tokenHash: tokenHashOf(crypto.randomUUID()),
      expiresAt,
      usedAt,
      createdAt: ago(DAY),
    });
    const later = new Date(NOW.getTime() + DAY);
    const rows = await test_db
      .insert(SUserToken)
      .values([
        token(ago(1000), null),
        token(later, ago(1000)),
        token(later, null),
      ])
      .returning({ id: SUserToken.id });

    await scheduler().runOnce("tokens.cleanup");
    const left = await test_db
      .select({ id: SUserToken.id })
      .from(SUserToken)
      .where(
        inArray(
          SUserToken.id,
          rows.map((r) => r.id),
        ),
      );
    expect(left).toEqual([{ id: rows[2]?.id }]);
  });

  it("[FEAT-07][FEAT-08] loginAttempts.cleanup drops expired counters and ended locks, keeping live ones", async () => {
    const MIN = 60 * 1000;
    const hash = () => crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
    const [stale, endedLock, liveLock, recent] = [
      hash(),
      hash(),
      hash(),
      hash(),
    ];
    await test_db.insert(SLoginAttempt).values([
      { emailHash: stale, failures: 2, firstFailureAt: ago(20 * MIN) },
      {
        emailHash: endedLock,
        failures: 5,
        firstFailureAt: ago(40 * MIN),
        lockedUntil: ago(MIN),
      },
      {
        emailHash: liveLock,
        failures: 5,
        firstFailureAt: ago(20 * MIN),
        lockedUntil: new Date(NOW.getTime() + MIN),
      },
      { emailHash: recent, failures: 1, firstFailureAt: ago(MIN) },
    ]);

    await scheduler().runOnce("loginAttempts.cleanup");
    const left = await test_db
      .select({ hash: SLoginAttempt.emailHash })
      .from(SLoginAttempt)
      .where(
        inArray(SLoginAttempt.emailHash, [stale, endedLock, liveLock, recent]),
      );
    expect(left.map((r) => r.hash).sort()).toEqual([liveLock, recent].sort());
  });

  it("[FEAT-08] notifications.retention soft-deletes notifications older than the retention", async () => {
    const [old, recent] = await test_db
      .insert(SNotification)
      .values([
        {
          tenantId: test_tenant.id,
          userId: test_user.id,
          isBroadcast: false,
          event: "old",
          payload: {},
          createdAt: ago(181 * DAY),
        },
        {
          tenantId: test_tenant.id,
          userId: test_user.id,
          isBroadcast: false,
          event: "new",
          payload: {},
          createdAt: ago(DAY),
        },
      ])
      .returning({ id: SNotification.id });

    await scheduler().runOnce("notifications.retention");
    const rows = await test_db
      .select({ id: SNotification.id, isDeleted: SNotification.isDeleted })
      .from(SNotification)
      .where(inArray(SNotification.id, [old.id, recent.id]));
    expect(rows.find((r) => r.id === old.id)?.isDeleted).toBe(true);
    expect(rows.find((r) => r.id === recent.id)?.isDeleted).toBe(false);
    const [kept] = await test_db
      .select({ id: SNotification.id })
      .from(SNotification)
      .where(eq(SNotification.id, old.id));
    expect(kept).toBeDefined();
  });
});
