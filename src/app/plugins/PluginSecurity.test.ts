import { describe, it, expect, spyOn, afterEach } from "bun:test";
import { Elysia } from "elysia";
import { test_env, testHeaders } from "@/common/tests/TestManager.test";
import EnvManager from "@/infrastructure/env/EnvManager";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterUser } from "@f/user/routers/RouterUser";
import { RouterNotification } from "@f/notification/routers/RouterNotification";
import { RouterHealth } from "@f/health/routers/RouterHealth";
import { PluginSecurityHeaders } from "./PluginSecurityHeaders";
import { PluginBodyLimit } from "./PluginBodyLimit";
import { PluginCsrf } from "./PluginCsrf";

const ORIGIN = "https://app.example.com";

const production = () =>
  spyOn(EnvManager, "get").mockReturnValue({
    ...test_env,
    NODE_ENV: "production",
    CORS_ORIGINS: ORIGIN,
  });

const buildApp = () =>
  new Elysia()
    .use(PluginSecurityHeaders)
    .use(PluginBodyLimit)
    .use(PluginCsrf)
    .use(ErrorHandler)
    .group("/api", (api) => api.use(RouterHealth).group("/v1", (v1) => v1.use(RouterUser)));

describe("SEC-18: HTTP hardening", () => {
  afterEach(() => {
    spyOn(EnvManager, "get").mockReturnValue(test_env);
  });

  it("[SEC-18] security headers on every response (including 404); HSTS only in production", async () => {
    const app = buildApp();
    for (const path of ["/api/health/live", "/api/nope"]) {
      const res = await app.handle(new Request(`http://localhost${path}`));
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("strict-transport-security")).toBeNull();
    }

    production();
    const prod = await buildApp().handle(new Request("http://localhost/api/health/live"));
    expect(prod.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("[SEC-18] a body larger than MAX_REQUEST_BODY_BYTES → 413", async () => {
    const res = await buildApp().handle(
      new Request("http://localhost/api/v1/user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(test_env.MAX_REQUEST_BODY_BYTES + 1),
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
  });

  it("[SEC-18] a cross-origin cookie POST → 403; the allowed origin passes", async () => {
    const { Cookie } = await testHeaders();
    production();
    const app = buildApp();
    const put = (origin?: string, referer?: string) =>
      app.handle(
        new Request(`http://localhost/api/v1/user/${crypto.randomUUID()}`, {
          method: "PUT",
          headers: {
            Cookie,
            "content-type": "application/json",
            ...(origin ? { Origin: origin } : {}),
            ...(referer ? { Referer: referer } : {}),
          },
          body: JSON.stringify({ name: "x" }),
        }),
      );

    expect((await put("https://evil.example")).status).toBe(403);
    expect((await put()).status).toBe(403);
    expect((await put(undefined, "https://evil.example/page")).status).toBe(403);
    // Allowed origin (or referer) reaches the route (404: unknown user).
    expect((await put(ORIGIN)).status).toBe(404);
    expect((await put(undefined, `${ORIGIN}/settings`)).status).toBe(404);
  });

  it("[SEC-18] requests without the auth cookie and exempt endpoints are not CSRF-checked", async () => {
    production();
    const app = buildApp();
    const noCookie = await app.handle(
      new Request("http://localhost/api/v1/user", {
        method: "POST",
        headers: { "content-type": "application/json", Origin: "https://evil.example" },
        body: "{}",
      }),
    );
    expect(noCookie.status).not.toBe(403);

    const health = await app.handle(
      new Request("http://localhost/api/health/live", {
        method: "POST",
        headers: { Cookie: "accessToken=x", Origin: "https://evil.example" },
      }),
    );
    expect(health.status).not.toBe(403);
  });

  it("[SEC-18] WebSocket upgrade from a disallowed Origin is rejected (403) in production", async () => {
    const headers = await testHeaders();
    production();
    // The Origin gate runs in beforeHandle, before any upgrade happens, so it
    // is observable without opening a socket.
    const app = new Elysia().use(RouterNotification);
    const upgrade = (origin: string) =>
      app.handle(
        new Request("http://localhost/notifications/live", {
          headers: {
            ...headers,
            Origin: origin,
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          },
        }),
      );
    expect((await upgrade("https://evil.example")).status).toBe(403);
    expect((await upgrade(ORIGIN)).status).not.toBe(403);
  });
});
