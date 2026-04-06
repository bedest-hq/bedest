import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { RouterTenantPublic } from "./RouterTenantPublic";
import { test_tenant } from "@/common/tests/TestManager.test";

const api = treaty(RouterTenantPublic);

describe("RouterTenantPublic", () => {
  it("Resolve tenant by domain successfully", async () => {
    const res = await api.public.resolve.get({
      headers: {
        "x-tenant-domain": test_tenant.domain,
      },
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      id: test_tenant.id,
      name: test_tenant.name,
      logoId: test_tenant.logoId,
    });
  });

  it("Return 404 for an unknown domain", async () => {
    const res = await api.public.resolve.get({
      headers: {
        "x-tenant-domain": "unknown-magazine.com",
      },
    });

    expect(res.status).toBe(404);
  });
});
