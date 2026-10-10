import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import Context from "@/app/Context";
import { testHeaders, testUserHeaders } from "@/common/tests/TestManager.test";
import { RouterSystem } from "./RouterSystem";

const api = treaty(RouterSystem);

describe("RouterSystem", () => {
  it("Get initial maintenance status", async () => {
    const headers = await testHeaders();

    const res = await api.system.maintenance.get({
      headers,
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      isMaintenance: false,
    });
  });

  it("Enable maintenance mode", async () => {
    const headers = await testHeaders();

    const res = await api.system.maintenance.post(
      {
        status: true,
      },
      {
        headers,
      },
    );

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      isMaintenance: true,
    });
  });

  it("Disable maintenance mode", async () => {
    const headers = await testHeaders();

    const res = await api.system.maintenance.post(
      {
        status: false,
      },
      {
        headers,
      },
    );

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      isMaintenance: false,
    });
  });

  it("Negative: Non-SYSTEM user receives 503 Service Unavailable when maintenance is enabled", async () => {
    const sysHeaders = await testHeaders();
    const userHeaders = await testUserHeaders();

    // Enable maintenance
    await api.system.maintenance.post(
      { status: true },
      { headers: sysHeaders },
    );

    try {
      const testApp = new Elysia()
        .use(Context.User())
        .get("/test-maintenance", () => ({ ok: true }));
      const client = treaty(testApp);

      const userRes = await client["test-maintenance"].get({
        headers: userHeaders,
      });
      expect(userRes.status).toBe(503);

      const sysRes = await client["test-maintenance"].get({
        headers: sysHeaders,
      });
      expect(sysRes.status).toBe(200);
    } finally {
      // Ensure maintenance is restored to false
      await api.system.maintenance.post(
        { status: false },
        { headers: sysHeaders },
      );
    }
  });
});
