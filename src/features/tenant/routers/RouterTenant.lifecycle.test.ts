import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import WsManager, {
  type IWsClient,
} from "@/infrastructure/websocket/WsManager";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SUser } from "@f/user/schemas/SUser";
import { SSession } from "@f/session/schemas/SSession";
import { SSystemLog } from "@f/system/schemas/SSystemLog";
import { RouterAuth } from "@f/auth/routers/RouterAuth";
import { STenant } from "../schemas/STenant";
import { RouterTenant } from "./RouterTenant";

const app = new Elysia().use(ErrorHandler).use(RouterTenant).use(RouterAuth);

const call = (method: string, path: string, cookie?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const userRow = async (id: string) => {
  const [row] = await test_db
    .select({
      isDeleted: SUser.isDeleted,
      deletedWithTenant: SUser.deletedWithTenant,
    })
    .from(SUser)
    .where(eq(SUser.id, id));
  return row;
};

const tenantDeleted = async (id: string) => {
  const [row] = await test_db
    .select({ isDeleted: STenant.isDeleted })
    .from(STenant)
    .where(eq(STenant.id, id));
  return row?.isDeleted;
};

const login = (email: string) =>
  call("POST", "/auth/login", undefined, { email, password: "test_password" });

/** A customer tenant with an admin, a user and a user deleted earlier. */
const customer = async () => {
  const admin = await createForeignTenant(EUserRole.ADMIN);
  const member = await createTestUser(EUserRole.USER, admin.tenant);
  const gone = await createTestUser(EUserRole.USER, admin.tenant);
  await test_db
    .update(SUser)
    .set({ isDeleted: true, deletedAt: new Date() })
    .where(eq(SUser.id, gone.user.id));
  return { tenant: admin.tenant, admin, member, gone };
};

const auditOf = async (action: string, tenantId: string) =>
  await test_db
    .select({ targetTenantId: SSystemLog.targetTenantId })
    .from(SSystemLog)
    .where(
      and(
        eq(SSystemLog.action, action),
        eq(SSystemLog.entity, "tenant"),
        eq(SSystemLog.entityId, tenantId),
      ),
    );

describe("FEAT-09: tenant lifecycle", () => {
  it("[FEAT-09] deleting a tenant soft-deletes it and its active users, revokes sessions, closes sockets, audits the target", async () => {
    const { tenant, admin, member, gone } = await customer();
    const closed: number[] = [];
    const ws: IWsClient = {
      id: crypto.randomUUID(),
      send: () => undefined,
      close: (code) => {
        closed.push(code ?? 0);
      },
    };
    const [session] = await test_db
      .select({ id: SSession.id })
      .from(SSession)
      .where(eq(SSession.userId, member.user.id));
    WsManager.registerClient(ws, {
      userId: member.user.id,
      sessionId: session?.id ?? "",
      expiresAt: Date.now() + 60_000,
    });

    const res = await call(
      "DELETE",
      `/tenant/${tenant.id}`,
      (await testHeaders()).Cookie,
    );
    expect(res.status).toBe(200);

    expect(await tenantDeleted(tenant.id)).toBe(true);
    expect(await userRow(admin.user.id)).toEqual({
      isDeleted: true,
      deletedWithTenant: true,
    });
    expect(await userRow(member.user.id)).toEqual({
      isDeleted: true,
      deletedWithTenant: true,
    });
    // Deleted before the tenant: not marked.
    expect(await userRow(gone.user.id)).toEqual({
      isDeleted: true,
      deletedWithTenant: false,
    });

    const sessions = await test_db
      .select({ id: SSession.id })
      .from(SSession)
      .where(eq(SSession.tenantId, tenant.id));
    expect(sessions).toEqual([]);
    expect(closed.length).toBeGreaterThan(0);
    expect(
      (await call("GET", "/tenant/self", member.headers.Cookie)).status,
    ).toBe(401);
    expect((await login(member.user.email)).status).toBe(401);

    expect(await auditOf("DELETE", tenant.id)).toEqual([
      { targetTenantId: tenant.id },
    ]);
  });

  it("[FEAT-09] restore brings back the tenant and the users deleted with it — not the ones deleted before", async () => {
    const { tenant, admin, member, gone } = await customer();
    const system = (await testHeaders()).Cookie;
    expect((await call("DELETE", `/tenant/${tenant.id}`, system)).status).toBe(
      200,
    );

    const res = await call("POST", `/tenant/${tenant.id}/restore`, system);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, restoredUsers: 2 });

    expect(await tenantDeleted(tenant.id)).toBe(false);
    expect(await userRow(admin.user.id)).toEqual({
      isDeleted: false,
      deletedWithTenant: false,
    });
    expect(await userRow(member.user.id)).toEqual({
      isDeleted: false,
      deletedWithTenant: false,
    });
    expect(await userRow(gone.user.id)).toEqual({
      isDeleted: true,
      deletedWithTenant: false,
    });

    expect((await login(member.user.email)).status).toBe(200);
    expect((await login(gone.user.email)).status).toBe(401);
    expect(await auditOf("RESTORE", tenant.id)).toEqual([
      { targetTenantId: tenant.id },
    ]);
  });

  it("[FEAT-09] restoring an active or unknown tenant → 404", async () => {
    const { tenant } = await customer();
    const system = (await testHeaders()).Cookie;
    expect(
      (await call("POST", `/tenant/${tenant.id}/restore`, system)).status,
    ).toBe(404);
    expect(
      (await call("POST", `/tenant/${crypto.randomUUID()}/restore`, system))
        .status,
    ).toBe(404);
  });

  it("[FEAT-09] only SYSTEM may restore", async () => {
    const { tenant } = await customer();
    expect(
      (
        await call(
          "DELETE",
          `/tenant/${tenant.id}`,
          (await testHeaders()).Cookie,
        )
      ).status,
    ).toBe(200);
    const admin = await createTestUser(EUserRole.ADMIN);
    expect(
      (await call("POST", `/tenant/${tenant.id}/restore`, admin.headers.Cookie))
        .status,
    ).toBe(403);
    expect((await call("POST", `/tenant/${tenant.id}/restore`)).status).toBe(
      401,
    );
    expect(await tenantDeleted(tenant.id)).toBe(true);
  });

  it("[FEAT-09] an e-mail taken meanwhile by another account → 409 and nothing is restored", async () => {
    const { tenant, member } = await customer();
    const system = (await testHeaders()).Cookie;
    expect((await call("DELETE", `/tenant/${tenant.id}`, system)).status).toBe(
      200,
    );
    const other = await createTestUser(EUserRole.USER);
    await test_db
      .update(SUser)
      .set({ email: member.user.email.toUpperCase() })
      .where(eq(SUser.id, other.user.id));

    const res = await call("POST", `/tenant/${tenant.id}/restore`, system);
    expect(res.status).toBe(409);
    expect(await tenantDeleted(tenant.id)).toBe(true);
    expect(await userRow(member.user.id)).toEqual({
      isDeleted: true,
      deletedWithTenant: true,
    });
  });
});
