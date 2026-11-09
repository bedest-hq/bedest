import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import {
  createForeignTenant,
  createTestUser,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import { RouterUser } from "./RouterUser";
import { EUserRole } from "../enums/EUserRole";

const app = new Elysia().use(ErrorHandler).use(RouterUser).use(RouterTenant);

const put = (path: string, body: unknown, cookie: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    }),
  );

const NO_FIELDS = { error: "Bad Request", message: "No fields to update" };

describe("BUG-02: empty update payloads", () => {
  it("[BUG-02] PUT /user/:id with {} → 400 with the documented body", async () => {
    const me = await createTestUser(EUserRole.USER);
    const res = await put(`/user/${me.user.id}`, {}, me.headers.Cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(NO_FIELDS);
  });

  it("[BUG-02] PUT /user/:id with only currentPassword → 400", async () => {
    const me = await createTestUser(EUserRole.USER);
    const res = await put(
      `/user/${me.user.id}`,
      { currentPassword: "test_password" },
      me.headers.Cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(NO_FIELDS);
  });

  it("[BUG-02] PUT /tenant/:id with {} as SYSTEM → 400", async () => {
    const foreign = await createForeignTenant(EUserRole.USER);
    const res = await put(
      `/tenant/${foreign.tenant.id}`,
      {},
      (await testHeaders()).Cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(NO_FIELDS);
  });

  it("[BUG-02] an ADMIN sending only plan fields (stripped) gets the same 400, not a fake success", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const res = await put(
      `/tenant/${admin.tenant.id}`,
      { plan: ETenantPlan.BASIC },
      admin.headers.Cookie,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(NO_FIELDS);
  });
});
