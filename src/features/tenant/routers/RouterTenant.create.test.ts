import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import {
  createForeignTenant,
  test_db,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SUser } from "@f/user/schemas/SUser";
import { ETenantPlan } from "../enums/ETenantPlan";
import { STenant } from "../schemas/STenant";
import { RouterTenant } from "./RouterTenant";

const app = new Elysia().use(ErrorHandler).use(RouterTenant);

const createTenant = async (email: string) => {
  const domain = `new-${crypto.randomUUID().slice(0, 8)}.example.com`;
  const res = await app.handle(
    new Request("http://localhost/tenant", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: (await testHeaders()).Cookie,
      },
      body: JSON.stringify({
        name: `Tenant ${domain}`,
        domain,
        country: "Germany",
        phones: ["+49123456789"],
        email,
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(),
      }),
    }),
  );
  return { res, domain };
};

const tenantsWithDomain = async (domain: string) =>
  test_db
    .select({ id: STenant.id })
    .from(STenant)
    .where(eq(STenant.domain, domain));

describe("BUG-16: tenant creation is atomic", () => {
  it("[BUG-16] an admin e-mail used in any tenant → 409 and no tenant row", async () => {
    const other = await createForeignTenant(EUserRole.USER);
    const { res, domain } = await createTenant(other.user.email.toUpperCase());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Conflict" });
    expect(await tenantsWithDomain(domain)).toEqual([]);
  });

  it("[BUG-16] success creates the tenant and its ADMIN together", async () => {
    const email = `admin_${crypto.randomUUID().slice(0, 8)}@example.com`;
    const { res, domain } = await createTenant(email);
    expect(res.status).toBe(200);
    const body: { id: string } = await res.json();

    expect(await tenantsWithDomain(domain)).toEqual([{ id: body.id }]);
    const admins = await test_db
      .select({ role: SUser.role })
      .from(SUser)
      .where(and(eq(SUser.tenantId, body.id), eq(SUser.email, email)));
    expect(admins).toEqual([{ role: EUserRole.ADMIN }]);
  });
});
