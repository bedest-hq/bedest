import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import {
  test_env,
  test_tenant,
  testSystemHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterTenant } from "./RouterTenant";
import { RouterTenantPublic } from "./RouterTenantPublic";

const app = new Elysia().use(ErrorHandler).use(RouterTenantPublic);

const resolve = (domain: string) =>
  app.handle(
    new Request("http://localhost/public/resolve", {
      headers: { "x-tenant-domain": domain },
    }),
  );

describe("SEC-25: public tenant resolution", () => {
  it("[SEC-25] an unknown domain → 404 'Tenant not found' (no product copy)", async () => {
    const res = await resolve("unknown-magazine.com");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Not Found",
      message: "Tenant not found",
    });
  });

  it("[SEC-25] a known domain still resolves", async () => {
    const res = await resolve(test_tenant.domain);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: test_tenant.id });
  });

  it("[SEC-25] the header must be a hostname of at most 255 characters", async () => {
    expect((await resolve("not a host!")).status).toBe(400);
    expect((await resolve("a!b")).status).toBe(400);
    expect((await resolve("under_score.example.com")).status).toBe(400);
    expect((await resolve("-leading.example.com")).status).toBe(400);
    expect((await resolve(`${"a".repeat(63)}.`.repeat(4) + "com")).status).toBe(
      400,
    );
  });

  it("[SEC-25] more than RATE_LIMIT_TENANT_RESOLVE_PER_MIN requests per IP and minute → 429", async () => {
    const max = test_env.RATE_LIMIT_TENANT_RESOLVE_PER_MIN;
    expect(max).toBe(30);
    for (let i = 0; i < max; i++) {
      expect((await resolve(`probe-${i}.example.com`)).status).toBe(404);
    }
    expect((await resolve("probe-last.example.com")).status).toBe(429);
  });
});

describe("SEC-25: limiter scope", () => {
  it("[SEC-25] the resolve limiter does not throttle the other tenant routes", async () => {
    const full = new Elysia().use(ErrorHandler).use(RouterTenant);
    const headers = await testSystemHeaders();
    for (let i = 0; i <= test_env.RATE_LIMIT_TENANT_RESOLVE_PER_MIN + 5; i++) {
      const res = await full.handle(
        new Request("http://localhost/tenant?limit=1&page=1", { headers }),
      );
      expect(res.status).toBe(200);
    }
  });
});
