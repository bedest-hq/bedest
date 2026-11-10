import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import {
  testHeaders,
  test_env,
  test_user,
} from "@/common/tests/TestManager.test";
import { RouterAuth } from "./RouterAuth";

const authApi = treaty(RouterAuth);
const asProcessEnv = (env: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(env)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );

/** A valid production mailer [FEAT-06]. */
const PRODUCTION_MAIL = {
  MAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "mailer-password",
  MAIL_FROM: "no-reply@example.com",
};

describe("SEC-01: login never falls back to seeded credentials", () => {
  for (const nodeEnv of ["development", "test", "production"] as const) {
    it(`[SEC-01] NODE_ENV=${nodeEnv}: {} and { email } only are rejected with 400`, async () => {
      // The router is imported fresh under this NODE_ENV in a child
      // process (as at server start), so this file's module graph and the
      // coverage of RouterAuth.ts stay untouched [TST-05].
      const proc = Bun.spawn(
        [process.execPath, "src/common/tests/fixtures/Sec01Login.fixture.ts"],
        {
          env: {
            PATH: process.env.PATH ?? "",
            Path: process.env.Path ?? "",
            ...asProcessEnv(test_env),
            ...(nodeEnv === "production" ? PRODUCTION_MAIL : {}),
            NODE_ENV: nodeEnv,
            LOG_LEVEL: "silent",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stdout] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(code).toBe(0);
      // {} and { email } only: both 400, no cookie.
      expect(JSON.parse(stdout.trim())).toEqual([
        { status: 400, cookies: 0 },
        { status: 400, cookies: 0 },
      ]);
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
    // The shared error envelope [BUG-14]; identical for both cases.
    expect(nonExistentEmailRes.error?.value as unknown).toStrictEqual({
      error: "Unauthorized",
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

    // [SEC-14] Tokens travel only in HttpOnly cookies, never in the body.
    expect(res.data).toStrictEqual({ success: true });
    expect(JSON.stringify(res.data)).not.toContain("accessToken");
    const setCookies = res.response.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("accessToken="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("refreshToken="))).toBe(true);
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
