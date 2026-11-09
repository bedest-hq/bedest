import { describe, it, expect } from "bun:test";
import { Elysia, status, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import Context from "@/app/Context";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  testHeaders,
  test_user,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { EUserRole } from "@f/user/enums/EUserRole";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { SSystemLog } from "../schemas/SSystemLog";

const app = new Elysia()
  .use(ErrorHandler)
  .use(RouterTenant)
  .use(
    new Elysia()
      .use(Context.User())
      .post("/things", () => ({ success: true }), { audit: { entity: "thing" } })
      .put("/things/:id", () => ({ success: true }), {
        params: t.Object({ id: t.String() }),
        audit: { entity: "thing", action: "RENAME" },
      })
      .delete(
        "/things/:id",
        () => {
          throw status(403, { error: "Forbidden" });
        },
        { audit: { entity: "thing" } },
      ),
  );

const call = async (method: string, path: string, cookie: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

// The audit row is written after the response is sent; poll briefly for it.
const newestRow = async (userId: string) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = await test_db
      .select()
      .from(SSystemLog)
      .where(eq(SSystemLog.userId, userId))
      .orderBy(desc(SSystemLog.createdAt))
      .limit(1);
    if (row) {
      return row;
    }
    await Bun.sleep(10);
  }
  throw new Error("no audit row written");
};

describe("BUG-11: audit rows record the configured entity, never a guessed id", () => {
  it("[BUG-11] a route without :id (and no id in the response) → entityId null, entity as configured", async () => {
    const { user, headers } = await createTestUser(EUserRole.USER);
    expect((await call("POST", "/things", headers.Cookie)).status).toBe(200);

    const row = await newestRow(user.id);
    expect(row).toMatchObject({ entity: "thing", action: "POST", entityId: null });
  });

  it("[BUG-11] the :id param is the entity id; the configured action is used", async () => {
    const { user, headers } = await createTestUser(EUserRole.USER);
    const id = crypto.randomUUID();
    expect((await call("PUT", `/things/${id}`, headers.Cookie)).status).toBe(200);

    expect(await newestRow(user.id)).toMatchObject({ entity: "thing", action: "RENAME", entityId: id });
  });

  it("[BUG-11] a non-UUID id is not stored as entityId (the row is still written)", async () => {
    const { user, headers } = await createTestUser(EUserRole.USER);
    expect((await call("PUT", "/things/not-a-uuid", headers.Cookie)).status).toBe(200);

    expect(await newestRow(user.id)).toMatchObject({ entity: "thing", entityId: null });
  });

  it("[BUG-11] a failed request is audited with the configured entity and without the actor as entity", async () => {
    const { user, headers } = await createTestUser(EUserRole.USER);
    const id = crypto.randomUUID();
    expect((await call("DELETE", `/things/${id}`, headers.Cookie)).status).toBe(403);

    const row = await newestRow(user.id);
    expect(row).toMatchObject({ entity: "thing", action: "FAILED_DELETE", entityId: id });
    expect(row.payload).toMatchObject({ statusCode: 403 });
    expect(row.entityId).not.toBe(user.id);
  });

  it("[BUG-11] SYSTEM changing another tenant records targetTenantId", async () => {
    const foreign = await createForeignTenant(EUserRole.ADMIN);
    const res = await call("PUT", `/tenant/${foreign.tenant.id}`, (await testHeaders()).Cookie, {
      description: "updated by SYSTEM",
    });
    expect(res.status).toBe(200);

    const row = await newestRow(test_user.id);
    expect(row).toMatchObject({
      entity: "tenant",
      entityId: foreign.tenant.id,
      targetTenantId: foreign.tenant.id,
    });
  });
});
