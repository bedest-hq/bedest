import { describe, it, expect, afterEach } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import RedisManager from "@/infrastructure/redis/RedisManager";
import { RouterUser } from "@f/user/routers/RouterUser";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import { RouterAuth } from "./RouterAuth";

const app = new Elysia()
  .use(ErrorHandler)
  .use(RouterAuth)
  .use(RouterUser)
  .use(RouterTenant);

const PASSWORD = "test_password";

const call = (
  method: string,
  path: string,
  cookie?: string,
  body?: unknown,
) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");

const login = async (email: string) => {
  const res = await call("POST", "/auth/login", undefined, {
    email,
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
  return cookiesOf(res);
};

const accessRole = (cookie: string): unknown => {
  const token = cookie
    .split("; ")
    .find((c) => c.startsWith("accessToken="))
    ?.slice("accessToken=".length);
  const payload = token?.split(".")[1] ?? "";
  return (
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: unknown;
    }
  ).role;
};

describe("SEC-08: revoked, deleted or demoted principals lose access", () => {
  afterEach(async () => {
    await RedisManager.close();
  });

  it("[SEC-08] after logout the same access cookie is rejected (401)", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const cookie = await login(user.email);

    expect((await call("GET", "/user/self", cookie)).status).toBe(200);
    expect((await call("POST", "/auth/logout", cookie)).status).toBe(200);
    expect((await call("GET", "/user/self", cookie)).status).toBe(401);
  });

  it("[SEC-08] a deleted user can neither refresh nor use the access cookie", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const cookie = await login(user.email);
    expect((await call("GET", "/user/self", cookie)).status).toBe(200);

    const system = await testHeaders();
    expect(
      (await call("DELETE", `/user/${user.id}`, system.Cookie)).status,
    ).toBe(200);

    expect((await call("POST", "/auth/refresh", cookie)).status).toBe(401);
    expect((await call("GET", "/user/self", cookie)).status).toBe(401);
  });

  it("[SEC-08] a demoted ADMIN gets role USER on refresh and loses admin routes", async () => {
    const { user } = await createTestUser(EUserRole.ADMIN);
    const cookie = await login(user.email);
    expect((await call("GET", "/user?limit=10&page=1", cookie)).status).toBe(
      200,
    );

    // Out-of-band demotion (e.g. an operator editing the row).
    await test_db
      .update(SUser)
      .set({ role: EUserRole.USER })
      .where(eq(SUser.id, user.id));

    const refreshed = await call("POST", "/auth/refresh", cookie);
    expect(refreshed.status).toBe(200);
    const newCookie = cookiesOf(refreshed);
    expect(accessRole(newCookie)).toBe(EUserRole.USER);
    expect(
      (await call("GET", "/user?limit=10&page=1", newCookie)).status,
    ).toBe(403);
  });

  it("[SEC-08] a role change through the API revokes the target's sessions", async () => {
    const { user } = await createTestUser(EUserRole.ADMIN);
    const cookie = await login(user.email);

    const system = await testHeaders();
    expect(
      (
        await call("PUT", `/user/${user.id}`, system.Cookie, {
          role: EUserRole.USER,
        })
      ).status,
    ).toBe(200);

    expect((await call("GET", "/user/self", cookie)).status).toBe(401);
    expect((await call("POST", "/auth/refresh", cookie)).status).toBe(401);
  });

  it("[SEC-08] deleting a tenant blocks its users' login and refresh (401)", async () => {
    const foreign = await createForeignTenant(EUserRole.USER);
    const cookie = await login(foreign.user.email);

    const system = await testHeaders();
    expect(
      (await call("DELETE", `/tenant/${foreign.tenant.id}`, system.Cookie))
        .status,
    ).toBe(200);

    const relogin = await call("POST", "/auth/login", undefined, {
      email: foreign.user.email,
      password: PASSWORD,
    });
    expect(relogin.status).toBe(401);
    expect((await call("POST", "/auth/refresh", cookie)).status).toBe(401);
    expect((await call("GET", "/user/self", cookie)).status).toBe(401);
  });

  it("[SEC-08] changing your password revokes your other sessions but keeps the current one", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const current = await login(user.email);
    const other = await login(user.email);

    expect(
      (
        await call("PUT", `/user/${user.id}`, current, {
          currentPassword: PASSWORD,
          password: "another-strong-password",
        })
      ).status,
    ).toBe(200);

    expect((await call("POST", "/auth/refresh", other)).status).toBe(401);
    expect((await call("GET", "/user/self", other)).status).toBe(401);
    expect((await call("GET", "/user/self", current)).status).toBe(200);
    expect((await call("POST", "/auth/refresh", current)).status).toBe(200);
  });

  it("[SEC-08] an admin password reset revokes every session of the target", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const cookie = await login(user.email);
    const system = await testHeaders();

    expect(
      (
        await call("PUT", `/user/${user.id}`, system.Cookie, {
          password: "reset-by-the-admin-1",
        })
      ).status,
    ).toBe(200);

    expect((await call("GET", "/user/self", cookie)).status).toBe(401);
    expect((await call("POST", "/auth/refresh", cookie)).status).toBe(401);
  });

  it("[SEC-08] a revocation recorded in Redis by another node is honoured immediately", async () => {
    const store = new Map<string, string>();
    const fake = {
      status: "ready",
      on: () => fake,
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve("OK");
      },
      del: (key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      },
      quit: () => Promise.resolve("OK"),
      disconnect: () => undefined,
    };
    RedisManager.setClientsForTesting(fake, fake, fake);

    const { user } = await createTestUser(EUserRole.USER);
    const cookie = await login(user.email);
    // Warm this node's session cache.
    expect((await call("GET", "/user/self", cookie)).status).toBe(200);

    const sessionId = (
      JSON.parse(
        Buffer.from(
          (
            cookie
              .split("; ")
              .find((c) => c.startsWith("accessToken="))
              ?.split(".")[1] ?? ""
          ),
          "base64url",
        ).toString("utf8"),
      ) as { sessionId: string }
    ).sessionId;
    store.set(`session:revoked:${sessionId}`, "1");

    expect((await call("GET", "/user/self", cookie)).status).toBe(401);
  });
});
