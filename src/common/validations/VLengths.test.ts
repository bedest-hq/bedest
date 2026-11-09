import { describe, it, expect, spyOn } from "bun:test";
import { Elysia } from "elysia";
import {
  createForeignTenant,
  createTestUser,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { EUserRole } from "@f/user/enums/EUserRole";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { RouterUser } from "@f/user/routers/RouterUser";
import { RouterStorage } from "@f/storage/routers/RouterStorage";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

const app = new Elysia()
  .use(ErrorHandler)
  .use(RouterTenant)
  .use(RouterUser)
  .use(RouterStorage);

const send = (method: string, path: string, cookie: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    }),
  );

/** 400 validation error naming `field` (never a database error). */
const expectFieldError = async (res: Response, field: string) => {
  expect(res.status).toBe(400);
  const body: { message?: string; details?: Array<{ field: string }> } =
    await res.json();
  expect(body.message).toBe("Validation failed");
  expect(body.details?.map((d) => d.field)).toContain(field);
};

const newTenant = (overrides: Record<string, unknown>) => ({
  name: "Length Tenant",
  domain: `len-${crypto.randomUUID().slice(0, 8)}.example.com`,
  country: "Germany",
  phones: ["+49123456789"],
  email: `len_${crypto.randomUUID().slice(0, 8)}@example.com`,
  plan: ETenantPlan.BASIC,
  planStart: new Date(),
  planEnd: new Date(),
  ...overrides,
});

describe("QLT-11: inputs are bounded by their columns", () => {
  it("[QLT-11] a 256-character tenant name → 400 (varchar(255))", async () => {
    const res = await send(
      "POST",
      "/tenant",
      (await testHeaders()).Cookie,
      newTenant({ name: "n".repeat(256) }),
    );
    await expectFieldError(res, "name");
  });

  it("[QLT-11] tenant update fields are bounded too (description 1000, currency 3, phones items 255)", async () => {
    const admin = await createForeignTenant(EUserRole.ADMIN);
    const path = `/tenant/${admin.tenant.id}`;
    await expectFieldError(
      await send("PUT", path, admin.headers.Cookie, {
        description: "d".repeat(1001),
      }),
      "description",
    );
    await expectFieldError(
      await send("PUT", path, admin.headers.Cookie, { currency: "EURO" }),
      "currency",
    );
    await expectFieldError(
      await send("PUT", path, admin.headers.Cookie, {
        phones: ["p".repeat(256)],
      }),
      "phones/0",
    );
  });

  it("[QLT-11] a 256-character user name → 400", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    await expectFieldError(
      await send("POST", "/user", admin.headers.Cookie, {
        name: "u".repeat(256),
        email: `u_${crypto.randomUUID().slice(0, 8)}@example.com`,
        role: EUserRole.USER,
        password: "a-long-enough-password",
      }),
      "name",
    );
    await expectFieldError(
      await send("PUT", `/user/${admin.user.id}`, admin.headers.Cookie, {
        name: "u".repeat(256),
      }),
      "name",
    );
  });

  it("[QLT-11] presign: name 255 and mimeType 100", async () => {
    const headers = await testHeaders();
    await expectFieldError(
      await send("POST", "/storage/presign-upload", headers.Cookie, {
        name: "f".repeat(256),
        mimeType: "image/png",
        size: 10,
      }),
      "name",
    );
  });

  it("[QLT-11] an uploaded file name longer than 255 characters → 400 before anything is stored", async () => {
    const put = spyOn(StorageManager.default, "upload").mockImplementation(() =>
      Promise.resolve(),
    );
    put.mockClear();
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84,
      120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69,
      78, 68, 174, 66, 96, 130,
    ]);
    const form = new FormData();
    form.append(
      "file",
      new File([png], `${"n".repeat(252)}.png`, { type: "image/png" }),
    );
    const res = await app.handle(
      new Request("http://localhost/storage/upload", {
        method: "POST",
        headers: { Cookie: (await testHeaders()).Cookie },
        body: form,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Bad Request",
      message: "File name is longer than 255 characters",
    });
    expect(put).not.toHaveBeenCalled();
  });
});
