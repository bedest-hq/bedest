import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { password as bunPassword } from "bun";
import {
  createTestUser,
  test_db,
  test_tenant,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterAuth } from "@f/auth/routers/RouterAuth";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import { SUser } from "../schemas/SUser";
import { RouterUser } from "./RouterUser";
import { EUserRole } from "../enums/EUserRole";

const app = new Elysia()
  .use(ErrorHandler)
  .use(RouterAuth)
  .use(RouterUser)
  .use(RouterTenant);

const send = (method: string, path: string, body: unknown, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const ELEVEN = "a".repeat(11);
const TWELVE = "b".repeat(12);

const passwordFieldError = async (res: Response) => {
  expect(res.status).toBe(400);
  const body: unknown = await res.json();
  expect(body).toMatchObject({
    details: expect.arrayContaining([
      expect.objectContaining({ field: "password" }),
    ]),
  });
};

describe("SEC-23: password policy", () => {
  it("[SEC-23] POST /user rejects an 11-character password and accepts 12", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const user = (pw: string) => ({
      name: "New",
      email: `pw_${crypto.randomUUID().slice(0, 8)}@example.com`,
      role: EUserRole.USER,
      password: pw,
    });

    await passwordFieldError(
      await send("POST", "/user", user(ELEVEN), admin.headers.Cookie),
    );
    expect(
      (await send("POST", "/user", user(TWELVE), admin.headers.Cookie)).status,
    ).toBe(200);
  });

  it("[SEC-23] POST /user rejects a password longer than 128 characters", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const res = await send(
      "POST",
      "/user",
      {
        name: "New",
        email: `pw_${crypto.randomUUID().slice(0, 8)}@example.com`,
        role: EUserRole.USER,
        password: "c".repeat(129),
      },
      admin.headers.Cookie,
    );
    await passwordFieldError(res);
  });

  it("[SEC-23] PUT /user/:id: a new password needs 12 characters; the current one may be short", async () => {
    const me = await createTestUser(EUserRole.USER);
    const path = `/user/${me.user.id}`;

    await passwordFieldError(
      await send(
        "PUT",
        path,
        { currentPassword: "test_password", password: ELEVEN },
        me.headers.Cookie,
      ),
    );
    expect(
      (
        await send(
          "PUT",
          path,
          { currentPassword: "test_password", password: TWELVE },
          me.headers.Cookie,
        )
      ).status,
    ).toBe(200);
  });

  it("[SEC-23] an existing user with a short legacy password can still log in", async () => {
    const email = `legacy_${crypto.randomUUID().slice(0, 8)}@example.com`;
    await test_db.insert(SUser).values({
      name: "Legacy",
      email,
      tenantId: test_tenant.id,
      password: await bunPassword.hash("short1"),
      role: EUserRole.USER,
      createdAt: new Date(),
    });

    const res = await send("POST", "/auth/login", {
      email,
      password: "short1",
    });
    expect(res.status).toBe(200);
  });

  it("[SEC-23] login rejects a password longer than 128 characters before hashing", async () => {
    const res = await send("POST", "/auth/login", {
      email: "nobody@example.com",
      password: "d".repeat(129),
    });
    expect(res.status).toBe(400);
  });

  it("[SEC-23] POST /tenant generates a 128-bit random admin password", async () => {
    const headers = await testHeaders();
    const res = await send(
      "POST",
      "/tenant",
      {
        name: "Password Tenant",
        domain: `pw-${crypto.randomUUID().slice(0, 8)}.example.com`,
        country: "Germany",
        phones: ["+49123456789"],
        links: [],
        email: `admin_${crypto.randomUUID().slice(0, 8)}@example.com`,
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(),
      },
      headers.Cookie,
    );
    expect(res.status).toBe(200);
    // 16 random bytes, base64url without padding → 22 characters.
    expect(await res.json()).toMatchObject({
      password: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });
  });
});
