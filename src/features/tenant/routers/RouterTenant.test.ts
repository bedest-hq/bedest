import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { RouterTenant } from "./RouterTenant";
import { testHeaders, test_tenant } from "@/common/tests/TestManager.test";
import { ETenantPlan } from "../enums/ETenantPlan";

const api = treaty(RouterTenant);

describe("RouterTenant", () => {
  it("Get tenant by id", async () => {
    const headers = await testHeaders();

    const res = await api.tenant({ id: test_tenant.id }).get({
      headers: headers,
    });

    expect(res.data).toStrictEqual({
      email: "test@example.com",
      name: "Test Tenant",
    });
  });

  it("Create a new tenant", async () => {
    const headers = await testHeaders();

    const res = await api.tenant.post(
      {
        name: "New Created Tenant",
        country: "Germany",
        phone: "+49123456789",
        email: "new@tenant.com",
        plan: ETenantPlan.PROFESSIONAL,
        planStart: new Date(),
        planEnd: new Date(),
      },
      {
        headers: headers,
      },
    );

    expect(res.data).toStrictEqual({ id: expect.any(String) });
    expect(res.data!.id).toHaveLength(36);
  });

  it("Update tenant", async () => {
    const headers = await testHeaders();

    const res = await api.tenant({ id: test_tenant.id }).put(
      {
        email: "updated@tenant.com",
      },
      { headers },
    );

    expect(res.status).toBe(200);

    const updatedRes = await api.tenant({ id: test_tenant.id }).get({
      headers: headers,
    });

    expect(updatedRes.data).toStrictEqual({
      email: "updated@tenant.com",
      name: "Test Tenant",
    });
  });

  it("Delete example", async () => {
    const headers = await testHeaders();

    const res = await api.tenant({ id: test_tenant.id }).delete(
      {},
      {
        headers,
      },
    );

    expect(res.status).toBe(200);

    const checkRes = await api.tenant({ id: test_tenant.id }).get({
      headers,
    });

    expect(checkRes.status).toBe(404);
  });
});
