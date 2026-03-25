import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { testHeaders } from "@/common/tests/TestManager.test";
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
});
