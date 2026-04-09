import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import {
  testHeaders,
  test_user,
  test_tenant,
  test_db,
} from "@/common/tests/TestManager.test";
import { RouterSystemLog } from "./RouterSystemLog";
import { SSystemLog } from "../schemas/SSystemLog";
import { SYSTEM_UUID } from "@/common/constants";

const api = treaty(RouterSystemLog);

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
});
