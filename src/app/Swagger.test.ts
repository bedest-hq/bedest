import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { test_env } from "@/common/tests/TestManager.test";
import { createRouter } from "./Router";

const docs = (overrides: Partial<typeof test_env>, path = "/api/docs") =>
  new Elysia()
    .use(createRouter({ ...test_env, ...overrides }))
    .handle(new Request(`http://localhost${path}`));

describe("SEC-17: API documentation exposure", () => {
  it("[SEC-17] production → GET /api/docs is 404", async () => {
    expect((await docs({ NODE_ENV: "production" })).status).toBe(404);
    expect((await docs({ NODE_ENV: "production" }, "/api/docs/json")).status).toBe(404);
  });

  it("[SEC-17] production with ENABLE_API_DOCS=true serves the docs", async () => {
    expect(
      (await docs({ NODE_ENV: "production", ENABLE_API_DOCS: true })).status,
    ).toBe(200);
  });

  it("[SEC-17] development serves the docs and declares the accessToken cookie scheme", async () => {
    expect((await docs({ NODE_ENV: "development" })).status).toBe(200);
    const spec = (await (
      await docs({ NODE_ENV: "development" }, "/api/docs/json")
    ).json()) as {
      components?: { securitySchemes?: Record<string, unknown> };
    };
    expect(spec.components?.securitySchemes?.accessToken).toEqual({
      type: "apiKey",
      in: "cookie",
      name: "accessToken",
    });
    expect(Object.keys((spec as { paths?: object }).paths ?? {})).toContain(
      "/api/v1/auth/login",
    );
  });
});
