import { describe, it, expect } from "bun:test";
import { eq } from "drizzle-orm";
import type { ITenantUserApp } from "bedest-core";
import {
  createForeignTenant,
  createTestUser,
  test_owner_db,
  test_db,
} from "@/common/tests/TestManager.test";
import { EUserRole } from "@f/user/enums/EUserRole";
import { ETenantPlan } from "../enums/ETenantPlan";
import { STenant } from "../schemas/STenant";
import ServiceTenant from "./ServiceTenant";

const runtime = (
  user: { id: string; role: EUserRole },
  tenantId: string,
): ITenantUserApp => ({
  db: test_owner_db,
  nowDatetime: new Date(),
  tenantId,
  session: {
    userId: user.id,
    sessionId: crypto.randomUUID(),
    role: user.role,
    isSuperUser: user.role === EUserRole.SYSTEM,
  },
});

const codeOf = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err ? err.code : err;

const thrown = (p: Promise<unknown>) =>
  p.then(
    () => "no-throw",
    (e: unknown) => e,
  );

describe("BUG-15: tenant authorization lives in the service", () => {
  it("[BUG-15] ADMIN remove(own tenant) → 403 (tenant deletion is SYSTEM-only)", async () => {
    const admin = await createForeignTenant(EUserRole.ADMIN);
    const ctx = runtime(admin.user, admin.tenant.id);
    expect(
      codeOf(await thrown(ServiceTenant.remove(ctx, admin.tenant.id))),
    ).toBe(403);

    const [row] = await test_db
      .select({ isDeleted: STenant.isDeleted })
      .from(STenant)
      .where(eq(STenant.id, admin.tenant.id));
    expect(row.isDeleted).toBe(false);
  });

  it("[BUG-15] ADMIN remove(another tenant) → 403", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const foreign = await createForeignTenant(EUserRole.USER);
    const ctx = runtime(admin.user, admin.tenant.id);
    expect(
      codeOf(await thrown(ServiceTenant.remove(ctx, foreign.tenant.id))),
    ).toBe(403);
  });

  it("[BUG-15] ADMIN update: plan fields are ignored and the caller's object is not mutated", async () => {
    const admin = await createForeignTenant(EUserRole.ADMIN);
    const ctx = runtime(admin.user, admin.tenant.id);
    const data = {
      description: "changed by admin",
      plan: ETenantPlan.BASIC,
      planEnd: new Date("2000-01-01T00:00:00Z"),
    };

    expect(await ServiceTenant.update(ctx, admin.tenant.id, data)).toEqual({
      success: true,
    });

    expect(data).toEqual({
      description: "changed by admin",
      plan: ETenantPlan.BASIC,
      planEnd: new Date("2000-01-01T00:00:00Z"),
    });
    const [row] = await test_db
      .select({
        description: STenant.description,
        plan: STenant.plan,
        planEnd: STenant.planEnd,
      })
      .from(STenant)
      .where(eq(STenant.id, admin.tenant.id));
    expect(row.description).toBe("changed by admin");
    expect(row.plan).toBe(ETenantPlan.PROFESSIONAL);
    expect(row.planEnd.getTime()).toBe(admin.tenant.planEnd.getTime());
  });

  it("[BUG-15] ADMIN update of another tenant → 403", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const foreign = await createForeignTenant(EUserRole.USER);
    const ctx = runtime(admin.user, admin.tenant.id);
    expect(
      codeOf(
        await thrown(
          ServiceTenant.update(ctx, foreign.tenant.id, { description: "x" }),
        ),
      ),
    ).toBe(403);
  });
});
