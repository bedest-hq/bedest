import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { RouterTenant } from "./RouterTenant";
import { testHeaders, test_tenant } from "@/common/tests/TestManager.test";
import { ETenantPlan } from "../enums/ETenantPlan";

const api = treaty(RouterTenant);

describe("RouterTenant", () => {
  it("Get all with system", async () => {
    const headers = await testHeaders();

    await api.tenant.post(
      {
        name: "List Tenant",
        domain: "list.tenant.com",
        country: "France",
        phone: "+49123456789",
        email: "list@tenant.com",
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(),
      },
      { headers },
    );

    const res = await api.tenant.get({
      headers,
      query: { page: 1, limit: 100 },
    });

    expect(res.status).toBe(200);
    expect(res.data!.data.length).toBeGreaterThanOrEqual(2);
    expect(res.data!.data).toStrictEqual([
      {
        country: "France",
        domain: "list.tenant.com",
        email: "list@tenant.com",
        logoId: null,
        name: "List Tenant",
      },
      {
        name: "Test Tenant",
        domain: "test.com",
        email: "test@example.com",
        country: "Test Country",
        logoId: null,
      },
    ]);
  });

  it("Get tenant by id", async () => {
    const headers = await testHeaders();

    const res = await api.tenant({ id: test_tenant.id }).get({
      headers: headers,
    });

    expect(res.data).toStrictEqual({
      email: "test@example.com",
      domain: "test.com",
      name: "Test Tenant",
      country: "Test Country",
      phone: "05555555555",
      plan: ETenantPlan.PROFESSIONAL,
      logoId: null,
    });
  });

  it("Get Self", async () => {
    const headers = await testHeaders();

    const res = await api.tenant.self.get({
      headers: headers,
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      name: "Test Tenant",
      domain: "test.com",
      email: "test@example.com",
      country: "Test Country",
      phone: "05555555555",
      plan: ETenantPlan.PROFESSIONAL,
      planEnd: expect.any(Date),
      logoId: null,
    });
  });

  it("Create a new tenant", async () => {
    const headers = await testHeaders();

    const res = await api.tenant.post(
      {
        name: "New Created Tenant",
        domain: "new.com",
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

    expect(res.status).toBe(200);

    expect(res.data).toStrictEqual({
      id: expect.any(String),
      password: expect.any(String),
    });
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
      domain: "test.com",
      name: "Test Tenant",
      country: "Test Country",
      phone: "05555555555",
      plan: ETenantPlan.PROFESSIONAL,
      logoId: null,
    });
  });

  it("Delete tenant", async () => {
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
