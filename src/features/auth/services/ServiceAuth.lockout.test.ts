import { describe, it, expect, spyOn } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  createTestUser,
  test_db,
  test_runtime_db,
  test_system_user,
  testSystemHeaders,
} from "@/common/tests/TestManager.test";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SSystemLog } from "@f/system/schemas/SSystemLog";
import { SSession } from "@f/session/schemas/SSession";
import ServiceAuth from "./ServiceAuth";
import ServiceLoginLockout, {
  emailHashOf,
  LOCKOUT_WINDOW_MS,
} from "./ServiceLoginLockout";

const T0 = new Date("2026-06-01T12:00:00Z");
const at = (offsetMs: number) => ({
  db: test_runtime_db,
  nowDatetime: new Date(T0.getTime() + offsetMs),
});
const META = { ip: "203.0.113.7", userAgent: "lockout-test/1.0" };

const attempt = (offsetMs: number, email: string, password: string) =>
  ServiceAuth.login(at(offsetMs), { email, password }, META).then(
    () => "ok",
    (e: unknown) =>
      typeof e === "object" && e !== null && "code" in e ? e.code : e,
  );

const auditRows = async (actions: string[], emailHash: string) =>
  (
    await test_db
      .select({ action: SSystemLog.action, payload: SSystemLog.payload })
      .from(SSystemLog)
      .where(inArray(SSystemLog.action, actions))
  ).filter((r) => r.payload.emailHash === emailHash);

describe("FEAT-07: account lockout", () => {
  it("[FEAT-07] after 5 failures in 15 min even the right password gets the same 401", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const sessionsOf = async () =>
      (
        await test_db
          .select({ id: SSession.id })
          .from(SSession)
          .where(eq(SSession.userId, user.id))
      ).length;
    const before = await sessionsOf();
    for (let i = 0; i < 5; i++) {
      expect(await attempt(i * 1000, user.email, "wrong-password")).toBe(401);
    }
    expect(await attempt(6000, user.email, "test_password")).toBe(401);

    // No session was created for the locked attempt.
    expect(await sessionsOf()).toBe(before);
  });

  it("[FEAT-07] a locked attempt still spends a password hash (no timing shortcut)", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    for (let i = 0; i < 5; i++) {
      await attempt(i, user.email, "wrong-password");
    }
    const verify = spyOn(Bun.password, "verify");
    try {
      expect(await attempt(10, user.email, "test_password")).toBe(401);
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      verify.mockRestore();
    }
  });

  it("[FEAT-07] the lock ends after 15 min", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    for (let i = 0; i < 5; i++) {
      await attempt(i, user.email, "wrong-password");
    }
    expect(
      await attempt(LOCKOUT_WINDOW_MS + 10, user.email, "test_password"),
    ).toBe("ok");
  });

  it("[FEAT-07] a successful login resets the counter", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    for (let i = 0; i < 4; i++) {
      await attempt(i, user.email, "wrong-password");
    }
    expect(await attempt(10, user.email, "test_password")).toBe("ok");
    for (let i = 0; i < 4; i++) {
      await attempt(20 + i, user.email, "wrong-password");
    }
    expect(await attempt(30, user.email, "test_password")).toBe("ok");
  });

  it("[FEAT-07] failures older than the window do not add up", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    for (let i = 0; i < 4; i++) {
      await attempt(i, user.email, "wrong-password");
    }
    await attempt(LOCKOUT_WINDOW_MS + 1000, user.email, "wrong-password");
    expect(
      await ServiceLoginLockout.isLocked(
        at(LOCKOUT_WINDOW_MS + 2000),
        emailHashOf(user.email.toLowerCase()),
      ),
    ).toBe(false);
  });

  it("[FEAT-07] unknown e-mails are counted (and locked) like known ones", async () => {
    const email = `nobody_${crypto.randomUUID().slice(0, 8)}@example.com`;
    for (let i = 0; i < 5; i++) {
      expect(await attempt(i, email, "whatever-password")).toBe(401);
    }
    expect(await ServiceLoginLockout.isLocked(at(10), emailHashOf(email))).toBe(
      true,
    );
  });
});

describe("FEAT-07: security events", () => {
  it("[FEAT-07] LOGIN_FAILED carries the e-mail hash, IP and user agent — never the password or address; LOGIN_LOCKED once", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const hash = emailHashOf(user.email.toLowerCase());
    for (let i = 0; i < 5; i++) {
      await attempt(i, user.email, "secret-wrong-password");
    }

    // Writes are fire-and-forget safe but awaited here: rows exist now.
    const failed = await auditRows(["LOGIN_FAILED"], hash);
    expect(failed).toHaveLength(5);
    expect(failed[0]?.payload).toEqual({
      emailHash: hash,
      ip: META.ip,
      userAgent: META.userAgent,
    });
    const text = JSON.stringify(failed);
    expect(text).not.toContain("secret-wrong-password");
    expect(text).not.toContain(user.email);
    expect(await auditRows(["LOGIN_LOCKED"], hash)).toHaveLength(1);
  });

  it("[FEAT-07] LOGOUT, PASSWORD_CHANGED and ROLE_CHANGED are audited", async () => {
    // SYSTEM may grant ADMIN (SEC-12).
    const actor = {
      user: test_system_user,
      headers: await testSystemHeaders(),
    };
    const target = await createTestUser(EUserRole.USER);
    const { Elysia } = await import("elysia");
    const { ErrorHandler } =
      await import("@/infrastructure/error/ErrorHandler");
    const { RouterUser } = await import("@f/user/routers/RouterUser");
    const { RouterAuth } = await import("../routers/RouterAuth");
    const app = new Elysia().use(ErrorHandler).use(RouterUser).use(RouterAuth);
    const send = (
      method: string,
      path: string,
      cookie: string,
      body?: unknown,
    ) =>
      app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { "content-type": "application/json", Cookie: cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );

    expect(
      (
        await send("PUT", `/user/${target.user.id}`, actor.headers.Cookie, {
          password: "a-brand-new-password",
          role: EUserRole.ADMIN,
        })
      ).status,
    ).toBe(200);
    expect(
      (await send("POST", "/auth/logout", actor.headers.Cookie)).status,
    ).toBe(200);

    const rows = await test_db
      .select({
        action: SSystemLog.action,
        entityId: SSystemLog.entityId,
        payload: SSystemLog.payload,
      })
      .from(SSystemLog)
      .where(
        and(
          inArray(SSystemLog.action, [
            "PASSWORD_CHANGED",
            "ROLE_CHANGED",
            "LOGOUT",
          ]),
          eq(SSystemLog.userId, actor.user.id),
        ),
      );
    expect(rows.map((r) => r.action).sort()).toEqual([
      "LOGOUT",
      "PASSWORD_CHANGED",
      "ROLE_CHANGED",
    ]);
    expect(rows.find((r) => r.action === "ROLE_CHANGED")).toMatchObject({
      entityId: target.user.id,
      payload: { from: EUserRole.USER, to: EUserRole.ADMIN },
    });
    expect(JSON.stringify(rows)).not.toContain("a-brand-new-password");
  });
});
