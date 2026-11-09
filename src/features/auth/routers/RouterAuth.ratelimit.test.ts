import { describe, it, expect, spyOn, afterEach } from "bun:test";
import { Elysia } from "elysia";
import {
  testHeaders,
  test_env,
  test_user,
} from "@/common/tests/TestManager.test";
import EnvManager from "@/infrastructure/env/EnvManager";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterUser } from "@f/user/routers/RouterUser";
import { RouterAuth } from "./RouterAuth";

const app = new Elysia().use(ErrorHandler).use(RouterAuth).use(RouterUser);

const login = (
  email: string,
  password: string,
  headers: Record<string, string> = {},
) =>
  app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email, password }),
    }),
  );

const cookieHeader = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

const withEnv = (overrides: Partial<typeof test_env>) =>
  spyOn(EnvManager, "get").mockReturnValue({ ...test_env, ...overrides });

describe("SEC-07: login/refresh rate limiting", () => {
  afterEach(() => {
    spyOn(EnvManager, "get").mockReturnValue(test_env);
  });

  it("[SEC-07] 6th login within the window → 429 while GET /user/self with a valid cookie still returns 200", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(test_user.email, "test_password")).status).toBe(200);
    }
    const sixth = await login(test_user.email, "test_password");
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).not.toBeNull();

    const headers = await testHeaders();
    for (let i = 0; i < 10; i++) {
      const self = await app.handle(
        new Request("http://localhost/user/self", { headers }),
      );
      expect(self.status).toBe(200);
    }
  });

  it("[SEC-07][NEW-02] failed logins count toward the limit (no refund on 401)", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(test_user.email, "wrong_password_123")).status).toBe(
        401,
      );
    }
    expect((await login(test_user.email, "test_password")).status).toBe(429);
  });

  it("[SEC-07] refresh requests do not consume the login budget", async () => {
    const first = await login(test_user.email, "test_password");
    expect(first.status).toBe(200);
    let cookies = cookieHeader(first);

    for (let i = 0; i < 8; i++) {
      const refreshed = await app.handle(
        new Request("http://localhost/auth/refresh", {
          method: "POST",
          headers: { Cookie: cookies },
        }),
      );
      expect(refreshed.status).toBe(200);
      cookies = cookieHeader(refreshed);
    }

    for (let i = 0; i < 4; i++) {
      expect((await login(test_user.email, "test_password")).status).toBe(200);
    }
  });

  it("[SEC-07] the per-IP login limit applies across different e-mails", async () => {
    withEnv({ RATE_LIMIT_LOGIN_IP_PER_MIN: 3 });
    for (let i = 0; i < 3; i++) {
      expect(
        (await login(`nobody${i}@example.com`, "whatever123")).status,
      ).toBe(401);
    }
    expect((await login("nobody9@example.com", "whatever123")).status).toBe(
      429,
    );
  });

  it("[SEC-07] X-Forwarded-For is ignored when TRUST_PROXY_HOPS=0", async () => {
    withEnv({ TRUST_PROXY_HOPS: 0 });
    for (let i = 0; i < 5; i++) {
      const res = await login(test_user.email, "test_password", {
        "x-forwarded-for": `203.0.113.${i + 1}`,
      });
      expect(res.status).toBe(200);
    }
    const sixth = await login(test_user.email, "test_password", {
      "x-forwarded-for": "203.0.113.99",
    });
    expect(sixth.status).toBe(429);
  });

  it("[SEC-07] X-Forwarded-For is honoured when TRUST_PROXY_HOPS=1", async () => {
    withEnv({ TRUST_PROXY_HOPS: 1 });
    for (let i = 0; i < 7; i++) {
      const res = await login(test_user.email, "test_password", {
        // A spoofed left-most entry must not matter: the right-most is used.
        "x-forwarded-for": `10.9.9.9, 198.51.100.${i + 1}`,
      });
      expect(res.status).toBe(200);
    }
    for (let i = 0; i < 5; i++) {
      const res = await login(test_user.email, "test_password", {
        "x-forwarded-for": `10.0.0.${i}, 198.51.100.200`,
      });
      expect(res.status).toBe(200);
    }
    const blocked = await login(test_user.email, "test_password", {
      "x-forwarded-for": "198.51.100.200",
    });
    expect(blocked.status).toBe(429);
  });
});
