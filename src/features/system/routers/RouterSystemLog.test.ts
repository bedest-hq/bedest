import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import {
  testHeaders,
  testUserHeaders,
  test_user,
  test_tenant,
  test_db,
} from "@/common/tests/TestManager.test";
import { RouterSystemLog } from "./RouterSystemLog";
import { SSystemLog } from "../schemas/SSystemLog";
import { SYSTEM_UUID } from "@/common/constants";
import { RouterUser } from "@f/user/routers/RouterUser";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import { and, eq } from "drizzle-orm";

const api = treaty(RouterSystemLog);
const userApi = treaty(RouterUser);

describe("RouterSystemLog", () => {
  it("List and filter audit logs for ADMIN/SYSTEM", async () => {
    const headers = await testHeaders();

    await test_db.insert(SSystemLog).values({
      tenantId: test_tenant.id,
      userId: test_user.id,
      action: "PUNCH",
      entity: "captain_test",
      entityId: SYSTEM_UUID,
      payload: { message: "Test log payload" },
    });

    const res = await api.log.get({
      headers,
      query: { limit: 10, page: 1, entity: "captain_test", action: "PUNCH" },
    });

    expect(res.status).toBe(200);
    expect(res.data?.data.length).toBeGreaterThanOrEqual(1);

    const log = res.data?.data[0];
    expect(log?.action).toBe("PUNCH");
    expect(log?.entity).toBe("captain_test");
    expect(log?.payload).toStrictEqual({ message: "Test log payload" });
  });

  it("Get a specific audit log by ID", async () => {
    const headers = await testHeaders();

    const [insertedLog] = await test_db
      .insert(SSystemLog)
      .values({
        tenantId: test_tenant.id,
        userId: test_user.id,
        action: "DELETE",
        entity: "target_entity",
        entityId: SYSTEM_UUID,
        payload: { reason: "cleanup" },
      })
      .returning();

    const res = await api.log({ id: insertedLog.id }).get({ headers });

    expect(res.status).toBe(200);
    expect(res.data?.action).toBe("DELETE");
    expect(res.data?.payload).toStrictEqual({ reason: "cleanup" });
  });

  it("Return 404 for non-existent log ID", async () => {
    const headers = await testHeaders();

    const res = await api.log({ id: SYSTEM_UUID }).get({ headers });

    expect(res.status).toBe(404);
  });

  it("Capture failed and unauthorized requests in system_audit_logs via PluginAudit", async () => {
    const [regularUser] = await test_db
      .insert(SUser)
      .values({
        name: "Regular User Audit",
        email: "regaudit@example.com",
        tenantId: test_tenant.id,
        password: "hashedpassword",
        role: EUserRole.USER,
        createdAt: new Date(),
      })
      .returning();

    const userHeaders = await testHeaders(regularUser);

    // USER role cannot call DELETE /user/:id (requires ADMIN or SYSTEM)
    const deleteRes = await userApi
      .user({ id: test_user.id })
      .delete({}, { headers: userHeaders });

    expect(deleteRes.status).toBe(403);

    // Verify audit record was persisted in system_audit_logs
    const [failedLog] = await test_db
      .select()
      .from(SSystemLog)
      .where(
        and(
          eq(SSystemLog.userId, regularUser.id),
          eq(SSystemLog.action, "FAILED_DELETE"),
        ),
      )
      .limit(1);

    expect(failedLog).toBeDefined();
    expect(failedLog.action).toBe("FAILED_DELETE");
    expect((failedLog.payload as Record<string, unknown>).statusCode).toBe(403);
  });

  it("Regular USER role cannot call GET /system/log (RoleGuard restriction)", async () => {
    const userHeaders = await testUserHeaders();

    const res = await api.log.get({
      headers: userHeaders,
      query: { limit: 10, page: 1 },
    });

    expect(res.status).toBe(403);
  });
});
