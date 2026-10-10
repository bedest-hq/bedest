import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import Context from "@/app/Context";
import { RouterTenant } from "./RouterTenant";
import {
  testHeaders,
  testUserHeaders,
  createForeignTenant,
  test_tenant,
  test_db,
} from "@/common/tests/TestManager.test";
import { ETenantPlan } from "../enums/ETenantPlan";
import { STenant } from "../schemas/STenant";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@f/user/enums/EUserRole";

const api = treaty(RouterTenant);

describe("RouterTenant", () => {
  it("Get all with system", async () => {
    const headers = await testHeaders();

    await api.tenant.post(
      {
        name: "List Tenant",
        domain: "list.tenant.com",
        country: "France",
        phones: ["+49123456789"],
        links: [],
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
        id: expect.any(String),
        country: "France",
        domain: "list.tenant.com",
        email: "list@tenant.com",
        logoId: null,
        name: "List Tenant",
      },
      {
        id: expect.any(String),
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
      phones: ["05555555555"],
      links: [],
      address: null,
      city: null,
      state: null,
      zipCode: null,
      taxId: null,
      currency: "USD",
      timezone: "UTC",
      description: null,
      tagline: null,
      workingHours: null,
      copyright: null,
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
      id: expect.any(String),
      name: "Test Tenant",
      domain: "test.com",
      email: "test@example.com",
      country: "Test Country",
      phones: ["05555555555"],
      links: [],
      address: null,
      city: null,
      state: null,
      zipCode: null,
      taxId: null,
      currency: "USD",
      timezone: "UTC",
      description: null,
      tagline: null,
      workingHours: null,
      copyright: null,
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
        phones: ["+49123456789"],
        links: [],
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
      phones: ["05555555555"],
      links: [],
      address: null,
      city: null,
      state: null,
      zipCode: null,
      taxId: null,
      currency: "USD",
      timezone: "UTC",
      description: null,
      tagline: null,
      workingHours: null,
      copyright: null,
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

  it("Tenant A user calling GET /tenant/:tenantB_id receives a 403 Forbidden", async () => {
    const [tenantB] = await test_db
      .insert(STenant)
      .values({
        name: "Tenant B For Inspection",
        domain: "tenant-b-inspect.com",
        country: "USA",
        email: "tenant-b-inspect@example.com",
        phones: ["05555555556"],
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(),
      })
      .returning();

    const [userA] = await test_db
      .insert(SUser)
      .values({
        name: "Tenant A Regular User",
        email: "userA-inspect@test.com",
        tenantId: test_tenant.id,
        password: "hashedpassword",
        role: EUserRole.USER,
        createdAt: new Date(),
      })
      .returning();

    const userAHeaders = await testHeaders(userA);

    const res = await api.tenant({ id: tenantB.id }).get({
      headers: userAHeaders,
    });

    expect(res.status).toBe(403);
  });

  it("Tenant A admin calling PUT /tenant/:tenantB_id receives a 403 Forbidden", async () => {
    const [tenantB] = await test_db
      .insert(STenant)
      .values({
        name: "Tenant B For Update",
        domain: "tenant-b-update.com",
        country: "USA",
        email: "tenant-b-update@example.com",
        phones: ["05555555557"],
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(),
      })
      .returning();

    const [adminA] = await test_db
      .insert(SUser)
      .values({
        name: "Tenant A Admin",
        email: "adminA-update@test.com",
        tenantId: test_tenant.id,
        password: "hashedpassword",
        role: EUserRole.ADMIN,
        createdAt: new Date(),
      })
      .returning();

    const adminAHeaders = await testHeaders(adminA);

    const res = await api.tenant({ id: tenantB.id }).put(
      { name: "Hacked Tenant B" },
      { headers: adminAHeaders },
    );

    expect(res.status).toBe(403);
  });

  it("Tenant A admin cannot modify plan via PUT /tenant/:id (plan mutation stripped)", async () => {
    const [adminA] = await test_db
      .insert(SUser)
      .values({
        name: "Tenant A Admin Plan",
        email: "adminA-plan@test.com",
        tenantId: test_tenant.id,
        password: "hashedpassword",
        role: EUserRole.ADMIN,
        createdAt: new Date(),
      })
      .returning();

    const adminAHeaders = await testHeaders(adminA);

    const res = await api.tenant({ id: test_tenant.id }).put(
      {
        name: "Updated Name By Admin",
        plan: ETenantPlan.BASIC,
      },
      { headers: adminAHeaders },
    );

    expect(res.status).toBe(200);

    const checkRes = await api.tenant.self.get({ headers: adminAHeaders });
    expect(checkRes.data?.name).toBe("Updated Name By Admin");
    expect(checkRes.data?.plan).toBe(ETenantPlan.PROFESSIONAL);
  });

  it("Delete non-existent tenant returns 404 Not Found", async () => {
    const headers = await testHeaders();
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const res = await api.tenant({ id: fakeId }).delete({}, { headers });

    expect(res.status).toBe(404);
  });

  it("Regular USER role cannot call POST /tenant (RoleGuard restriction)", async () => {
    const userHeaders = await testUserHeaders();

    const res = await api.tenant.post(
      {
        name: "Unauthorized Tenant Creation",
        domain: "unauth.com",
        country: "Nowhere",
        phones: ["0123456789"],
        email: "unauth@tenant.com",
        plan: ETenantPlan.PROFESSIONAL,
        planStart: new Date(),
        planEnd: new Date(),
      },
      { headers: userHeaders },
    );

    expect(res.status).toBe(403);
  });

  it("Regular USER role cannot call GET /tenant (RoleGuard restriction)", async () => {
    const userHeaders = await testUserHeaders();

    const res = await api.tenant.get({
      headers: userHeaders,
      query: { limit: 10, page: 1 },
    });

    expect(res.status).toBe(403);
  });

  it("Cross-tenant isolation: Foreign tenant user cannot fetch another tenant by ID", async () => {
    const foreign = await createForeignTenant(EUserRole.USER);

    const res = await api
      .tenant({ id: test_tenant.id })
      .get({ headers: foreign.headers });

    expect(res.status).toBe(403);
  });

  it("Negative: PlanGuard rejects expired tenant with 402 Payment Required", async () => {
    const expiredPast = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [expiredTenant] = await test_db
      .insert(STenant)
      .values({
        name: "Expired Tenant",
        domain: "expired-test.com",
        country: "Test",
        email: "expired@test.com",
        phones: ["05555555557"],
        plan: ETenantPlan.PROFESSIONAL,
        planStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        planEnd: expiredPast,
      })
      .returning();

    const [expiredUser] = await test_db
      .insert(SUser)
      .values({
        name: "Expired User",
        email: "expired-user@test.com",
        tenantId: expiredTenant.id,
        password: "hashedpassword",
        role: EUserRole.USER,
        createdAt: new Date(),
      })
      .returning();

    const expiredHeaders = await testHeaders(expiredUser);

    const testApp = new Elysia()
      .use(Context.User())
      .get("/protected-plan", () => ({ status: "ok" }), {
        PlanGuard: [ETenantPlan.PROFESSIONAL],
      });

    const client = treaty(testApp);
    const res = await client["protected-plan"].get({ headers: expiredHeaders });
    expect(res.status).toBe(402);
  });
});
