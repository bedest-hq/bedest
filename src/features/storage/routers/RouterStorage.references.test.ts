import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  test_tenant,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SUser } from "@f/user/schemas/SUser";
import { STenant } from "@f/tenant/schemas/STenant";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { RouterUser } from "@f/user/routers/RouterUser";
import { SStorage } from "../schemas/SStorage";
import { EStorageStatus } from "../enums/EStorageStatus";

const app = new Elysia().use(ErrorHandler).use(RouterTenant).use(RouterUser);

const put = (path: string, body: unknown, cookie: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    }),
  );

const insertFile = async (tenantId: string, status = EStorageStatus.READY) => {
  const [row] = await test_db
    .insert(SStorage)
    .values({
      tenantId,
      name: "logo.png",
      key: `${tenantId}/${crypto.randomUUID()}.png`,
      mimeType: "image/png",
      size: 10,
      status,
    })
    .returning({ id: SStorage.id });
  return row.id;
};

const logoOf = async (tenantId: string) => {
  const [row] = await test_db
    .select({ logoId: STenant.logoId })
    .from(STenant)
    .where(eq(STenant.id, tenantId));
  return row.logoId;
};

const avatarOf = async (userId: string) => {
  const [row] = await test_db
    .select({ avatarId: SUser.avatarId })
    .from(SUser)
    .where(eq(SUser.id, userId));
  return row.avatarId;
};

describe("SEC-27: file references stay inside the tenant", () => {
  it("[SEC-27] tenant A cannot set its logo to tenant B's file → 404, logo unchanged", async () => {
    const adminA = await createForeignTenant(EUserRole.ADMIN);
    const fileB = await insertFile(test_tenant.id);

    const res = await put(`/tenant/${adminA.tenant.id}`, { logoId: fileB }, adminA.headers.Cookie);
    expect(res.status).toBe(404);
    expect(await logoOf(adminA.tenant.id)).toBeNull();
  });

  it("[SEC-27] a logo must be READY (pending upload → 400); a READY own file works", async () => {
    const adminA = await createForeignTenant(EUserRole.ADMIN);
    const pending = await insertFile(adminA.tenant.id, EStorageStatus.PENDING);
    expect(
      (await put(`/tenant/${adminA.tenant.id}`, { logoId: pending }, adminA.headers.Cookie)).status,
    ).toBe(400);

    const ready = await insertFile(adminA.tenant.id);
    expect(
      (await put(`/tenant/${adminA.tenant.id}`, { logoId: ready }, adminA.headers.Cookie)).status,
    ).toBe(200);
    expect(await logoOf(adminA.tenant.id)).toBe(ready);
  });

  it("[SEC-27] SYSTEM cannot give tenant B a logo stored in another tenant", async () => {
    const foreign = await createForeignTenant(EUserRole.ADMIN);
    const systemFile = await insertFile(test_tenant.id);
    const res = await put(
      `/tenant/${foreign.tenant.id}`,
      { logoId: systemFile },
      (await testHeaders()).Cookie,
    );
    expect(res.status).toBe(404);
  });

  it("[SEC-27] a user cannot use another tenant's file as avatar; own file and clearing work", async () => {
    const me = await createForeignTenant(EUserRole.USER);
    const foreignFile = await insertFile(test_tenant.id);
    const path = `/user/${me.user.id}`;

    expect((await put(path, { avatarId: foreignFile }, me.headers.Cookie)).status).toBe(404);
    expect(await avatarOf(me.user.id)).toBeNull();

    const own = await insertFile(me.tenant.id);
    expect((await put(path, { avatarId: own }, me.headers.Cookie)).status).toBe(200);
    expect(await avatarOf(me.user.id)).toBe(own);

    expect((await put(path, { avatarId: null }, me.headers.Cookie)).status).toBe(200);
    expect(await avatarOf(me.user.id)).toBeNull();
  });

  it("[SEC-27] tenants.logoId is a foreign key to storage_files", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    let failure: unknown = null;
    try {
      await test_db
        .update(STenant)
        .set({ logoId: crypto.randomUUID() })
        .where(eq(STenant.id, admin.tenant.id));
    } catch (err) {
      failure = err;
    }
    // 23503 = foreign_key_violation (on the driver error under `cause`).
    const cause: unknown =
      typeof failure === "object" && failure !== null && "cause" in failure
        ? failure.cause
        : null;
    expect(cause).toMatchObject({ code: "23503" });
  });
});
