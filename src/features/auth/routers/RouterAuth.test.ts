import { describe, it, expect, spyOn } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import {
  testHeaders,
  test_env,
  test_user,
} from "@/common/tests/TestManager.test";
import EnvManager from "@/infrastructure/env/EnvManager";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterAuth } from "./RouterAuth";

const authApi = treaty(RouterAuth);

const postLogin = (app: { handle: (r: Request) => Promise<Response> }, body: unknown) =>
  app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("SEC-01: login never falls back to seeded credentials", () => {
  for (const nodeEnv of ["development", "test", "production"] as const) {
    it(`[SEC-01] NODE_ENV=${nodeEnv}: {} and { email } only are rejected with 400`, async () => {
      const envSpy = spyOn(EnvManager, "get").mockReturnValue({
        ...test_env,
        NODE_ENV: nodeEnv,
      });
      // A fresh module instance so the router is built under this NODE_ENV.
      const modulePath = `./RouterAuth.ts?sec01=${nodeEnv}`;
      const mod: typeof import("./RouterAuth") = await import(modulePath);
      envSpy.mockReturnValue(test_env);

      const app = new Elysia().use(ErrorHandler).use(mod.RouterAuth);

      const empty = await postLogin(app, {});
      expect(empty.status).toBe(400);
      expect(empty.headers.getSetCookie()).toHaveLength(0);

      const emailOnly = await postLogin(app, { email: test_user.email });
      expect(emailOnly.status).toBe(400);
      expect(emailOnly.headers.getSetCookie()).toHaveLength(0);
    });
  }
});

describe("RouterAuth", () => {
  it("Login", async () => {
    const res = await authApi.auth.login.post({
      email: test_user.email,
      password: "test_password",
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({ id: test_user.id, success: true });

    const cookies = res.response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);

    const refreshTokenHeader = cookies.find((c) =>
      c.startsWith("refreshToken="),
    );

    expect(refreshTokenHeader).toBeDefined();
  });

  it("Fail to login with wrong credentials", async () => {
    const res = await authApi.auth.login.post({
      email: test_user.email,
      password: "wrong_password_123",
    });

    expect(res.status).not.toBe(200);
  });

  it("Prevent user enumeration by returning identical 401 response for non-existent email and wrong password", async () => {
    const wrongPasswordRes = await authApi.auth.login.post({
      email: test_user.email,
      password: "wrong_password_123",
    });

    const nonExistentEmailRes = await authApi.auth.login.post({
      email: "does_not_exist@example.com",
      password: "wrong_password_123",
    });

    expect(wrongPasswordRes.status).toBe(401);
    expect(nonExistentEmailRes.status).toBe(401);
    expect(wrongPasswordRes.error?.value).toStrictEqual(
      nonExistentEmailRes.error?.value,
    );
    expect(nonExistentEmailRes.error?.value as unknown).toStrictEqual({
      message: "Invalid email or password",
    });
  });

  it("Refresh token", async () => {
    const loginRes = await authApi.auth.login.post({
      email: test_user.email,
      password: "test_password",
    });
    const cookies = loginRes.response.headers.getSetCookie();
    const res = await authApi.auth.refresh.post(null, {
      headers: {
        Cookie: cookies,
      },
    });

    expect(res.status).toBe(200);

    expect(res.data).toHaveProperty("accessToken");

    expect(typeof res.data?.accessToken).toBe("string");
  });

  it("Fail to refresh without token", async () => {
    const res = await authApi.auth.refresh.post(null, {
      headers: {
        Cookie: "",
      },
    });

    expect(res.status).toBe(401);
  });

  it("Logout successfully", async () => {
    const headers = await testHeaders();

    const res = await authApi.auth.logout.post(
      {},
      {
        headers,
      },
    );

    expect(res.status).toBe(200);

    const cookies = res.response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("accessToken="))).toBe(true);
  });
});
