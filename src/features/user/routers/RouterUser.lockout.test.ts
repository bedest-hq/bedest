import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { eq } from "drizzle-orm";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  test_tenant,
  test_user,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { STenant } from "@f/tenant/schemas/STenant";
import { RouterUser } from "./RouterUser";
import { EUserRole } from "../enums/EUserRole";

const users = treaty(RouterUser);
const tenants = treaty(RouterTenant);

describe("SEC-13: no self-lockout and no orphaned tenants", () => {
  it("[SEC-13] deleting the last active ADMIN of a tenant → 409", async () => {
    const system = await testHeaders();
    const admin = await createForeignTenant(EUserRole.ADMIN);

    const res = await users
      .user({ id: admin.user.id })
      .delete({}, { headers: system });
    expect(res.status).toBe(409);

    // With a second ADMIN the first one can go.
    const second = await createTestUser(EUserRole.ADMIN, admin.tenant);
    expect(second.user.tenantId).toBe(admin.tenant.id);
    expect(
      (await users.user({ id: admin.user.id }).delete({}, { headers: system }))
        .status,
    ).toBe(200);
  });

  it("[SEC-13] deleting the last active SYSTEM user → 409", async () => {
    const self = await testHeaders(test_user);
    const res = await users
      .user({ id: test_user.id })
      .delete({}, { headers: self });
    expect(res.status).toBe(409);
  });

  it("[SEC-13] deleting the tenant that owns the acting SYSTEM user → 409", async () => {
    const res = await tenants
      .tenant({ id: test_tenant.id })
      .delete({}, { headers: await testHeaders() });
    expect(res.status).toBe(409);
  });

  it("[SEC-13] deleting the system tenant → 409", async () => {
    const other = await createForeignTenant(EUserRole.SYSTEM);
    await test_db
      .update(STenant)
      .set({ isSystem: true })
      .where(eq(STenant.id, other.tenant.id));

    const res = await tenants
      .tenant({ id: other.tenant.id })
      .delete({}, { headers: await testHeaders() });
    expect(res.status).toBe(409);
  });
});
