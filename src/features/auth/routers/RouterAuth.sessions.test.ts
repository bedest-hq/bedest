import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import {
  createTestUser,
  test_db,
  test_runtime_db,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import WsManager, {
  type IWsClient,
} from "@/infrastructure/websocket/WsManager";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SSession } from "@f/session/schemas/SSession";
import { SSystemLog } from "@f/system/schemas/SSystemLog";
import ServiceSession from "@f/session/services/ServiceSession";
import { RouterAuth } from "./RouterAuth";

const app = new Elysia().use(ErrorHandler).use(RouterAuth);

const call = (method: string, path: string, cookie?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "user-agent": "sessions-test/1.0",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

/** The session id inside an access-token cookie. */
const sessionIdOf = (cookie: string) => {
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const claims: { sessionId: string } = JSON.parse(
    atob(token.split(".")[1] ?? ""),
  );
  return claims.sessionId;
};

/** A user with three signed-in devices. */
const userWithDevices = async () => {
  const { user, headers } = await createTestUser(EUserRole.USER);
  const others = [await testHeaders(user), await testHeaders(user)];
  return { user, current: headers.Cookie, others: others.map((h) => h.Cookie) };
};

const activeIds = async (userId: string) =>
  (
    await test_db
      .select({ id: SSession.id })
      .from(SSession)
      .where(eq(SSession.userId, userId))
  ).map((r) => r.id);

describe("FEAT-05: session management", () => {
  it("[FEAT-05] login records the client IP and user agent", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const res = await call("POST", "/auth/login", undefined, {
      email: user.email,
      password: "test_password",
    });
    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith("accessToken="))
      ?.split(";")[0];
    const [row] = await test_db
      .select({
        userAgent: SSession.userAgent,
        ipAddress: SSession.ipAddress,
        lastUsedAt: SSession.lastUsedAt,
      })
      .from(SSession)
      .where(eq(SSession.id, sessionIdOf(cookie ?? "")));
    expect(row?.userAgent).toBe("sessions-test/1.0");
    expect(typeof row?.ipAddress).toBe("string");
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("[FEAT-05] GET /auth/sessions lists my active sessions and marks the current one", async () => {
    const { user, current, others } = await userWithDevices();
    const res = await call("GET", "/auth/sessions", current);
    expect(res.status).toBe(200);
    const list: Array<{ id: string; current: boolean }> = await res.json();
    expect(list.map((s) => s.id).sort()).toEqual(
      (await activeIds(user.id)).sort(),
    );
    expect(list.filter((s) => s.current).map((s) => s.id)).toEqual([
      sessionIdOf(current),
    ]);
    expect(list).toHaveLength(1 + others.length);
  });

  it("[FEAT-05] unauthenticated calls → 401", async () => {
    expect((await call("GET", "/auth/sessions")).status).toBe(401);
    expect(
      (await call("DELETE", `/auth/sessions/${crypto.randomUUID()}`)).status,
    ).toBe(401);
    expect(
      (
        await call("POST", "/auth/logout-all", undefined, {
          includeCurrent: true,
        })
      ).status,
    ).toBe(401);
  });

  it("[FEAT-05] DELETE /auth/sessions/:id revokes my session, closes its sockets and is audited", async () => {
    const { user, current, others } = await userWithDevices();
    const target = sessionIdOf(others[0] ?? "");
    const closed: number[] = [];
    const ws: IWsClient = {
      id: crypto.randomUUID(),
      send: () => undefined,
      close: (code) => {
        closed.push(code ?? 0);
      },
    };
    WsManager.registerClient(ws, {
      userId: user.id,
      sessionId: target,
      expiresAt: Date.now() + 60_000,
    });

    expect(
      (await call("DELETE", `/auth/sessions/${target}`, current)).status,
    ).toBe(200);
    expect(await activeIds(user.id)).not.toContain(target);
    expect(closed).toEqual([1008]);
    // The revoked device is signed out; the current one is not.
    expect((await call("GET", "/auth/sessions", others[0])).status).toBe(401);
    expect((await call("GET", "/auth/sessions", current)).status).toBe(200);

    const [audit] = await test_db
      .select({ entityId: SSystemLog.entityId })
      .from(SSystemLog)
      .where(
        and(
          eq(SSystemLog.action, "SESSION_REVOKED"),
          eq(SSystemLog.userId, user.id),
        ),
      );
    expect(audit?.entityId).toBe(target);
  });

  it("[FEAT-05] another user's session or an unknown id → 404", async () => {
    const me = await userWithDevices();
    const other = await createTestUser(EUserRole.USER);
    const foreign = sessionIdOf(other.headers.Cookie);
    expect(
      (await call("DELETE", `/auth/sessions/${foreign}`, me.current)).status,
    ).toBe(404);
    expect(await activeIds(other.user.id)).toContain(foreign);
    expect(
      (
        await call(
          "DELETE",
          `/auth/sessions/${crypto.randomUUID()}`,
          me.current,
        )
      ).status,
    ).toBe(404);
  });

  it("[FEAT-05] logout-all keeps the current session unless includeCurrent", async () => {
    const a = await userWithDevices();
    const keep = await call("POST", "/auth/logout-all", a.current, {
      includeCurrent: false,
    });
    expect(await keep.json()).toEqual({ success: true, revoked: 2 });
    expect(await activeIds(a.user.id)).toEqual([sessionIdOf(a.current)]);

    const b = await userWithDevices();
    const all = await call("POST", "/auth/logout-all", b.current, {
      includeCurrent: true,
    });
    expect(await all.json()).toEqual({ success: true, revoked: 3 });
    expect(await activeIds(b.user.id)).toEqual([]);
    expect(
      all.headers.getSetCookie().some((c) => c.startsWith("accessToken=;")),
    ).toBe(true);
  });

  it("[FEAT-05] lastUsedAt is written at most once per 5 minutes", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const created = await ServiceSession.create(
      { db: test_runtime_db, nowDatetime: new Date("2026-06-01T10:00:00Z") },
      { tenantId: user.tenantId, userId: user.id },
    );
    const check = async (iso: string) => {
      ServiceSession.clearCache();
      await ServiceSession.isActive(
        { db: test_runtime_db, nowDatetime: new Date(iso) },
        created.id,
      );
      const [row] = await test_db
        .select({ lastUsedAt: SSession.lastUsedAt })
        .from(SSession)
        .where(eq(SSession.id, created.id));
      return row?.lastUsedAt?.toISOString();
    };
    expect(await check("2026-06-01T10:01:00Z")).toBe(
      "2026-06-01T10:00:00.000Z",
    );
    expect(await check("2026-06-01T10:04:59Z")).toBe(
      "2026-06-01T10:00:00.000Z",
    );
    expect(await check("2026-06-01T10:06:00Z")).toBe(
      "2026-06-01T10:06:00.000Z",
    );
  });

  it("[FEAT-05] sessions.userId is a foreign key to users", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const failure = await test_db
      .insert(SSession)
      .values({
        userId: crypto.randomUUID(),
        tenantId: user.tenantId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .then(
        () => null,
        (e: unknown) =>
          typeof e === "object" && e !== null && "cause" in e ? e.cause : e,
      );
    expect(failure).toMatchObject({ code: "23503" });
    expect(await activeIds(user.id)).toHaveLength(1);
    const unused = await test_db
      .select({ id: SSession.id })
      .from(SSession)
      .where(inArray(SSession.userId, [user.id]));
    expect(unused).toHaveLength(1);
  });
});
