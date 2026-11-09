import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import jwt from "@elysiajs/jwt";
import { test_env, test_user } from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { JWT_AUDIENCE } from "../validations/VJwtPayload";
import { RouterAuth } from "./RouterAuth";

const app = new Elysia().use(ErrorHandler).use(RouterAuth);

const post = (path: string, cookie?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

/** The Set-Cookie line of `name`, or "" when absent. */
const setCookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";

const cookieValue = (line: string) => line.slice(line.indexOf("=") + 1).split(";")[0];

const login = async () => {
  const res = await post("/auth/login", undefined, {
    email: test_user.email,
    password: "test_password",
  });
  expect(res.status).toBe(200);
  const access = cookieValue(setCookie(res, "accessToken"));
  const refresh = cookieValue(setCookie(res, "refreshToken"));
  const claims: Record<string, unknown> = JSON.parse(atob(access.split(".")[1]));
  return { res, access, refresh, claims };
};

/** Signs arbitrary claims with a real key, like a leaked-key-free forgery. */
const sign = async (
  secret: string,
  claims: Record<string, string>,
  opts: { iss?: string; aud?: string } = {},
) => {
  const signer = new Elysia().use(
    jwt({
      name: "j",
      secret,
      exp: "15m",
      iss: opts.iss ?? test_env.JWT_ISSUER,
      aud: opts.aud ?? JWT_AUDIENCE,
    }),
  );
  return await signer.decorator.j.sign(claims);
};

const identity = (claims: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of ["userId", "tenantId", "sessionId", "role"]) {
    const value = claims[key];
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  // Plain checks: toMatchObject with expect.any() leaves `out` uncloneable
  // in Bun 1.2.20, and jose structuredClone()s the payload it signs.
  expect(typeof out.userId).toBe("string");
  expect(typeof out.sessionId).toBe("string");
  return out;
};

describe("SEC-24: cookie attributes", () => {
  it("[SEC-24] login sets a path-scoped, strict refresh cookie and a lax access cookie", async () => {
    const { res, claims } = await login();

    const refresh = setCookie(res, "refreshToken");
    expect(refresh).toContain("Path=/api/v1/auth");
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("SameSite=Strict");
    expect(refresh).toContain("Max-Age=604800");

    const access = setCookie(res, "accessToken");
    expect(access).toContain("Path=/");
    expect(access).not.toContain("Path=/api");
    expect(access).toContain("HttpOnly");
    expect(access).toContain("SameSite=Lax");

    expect(claims).toMatchObject({ iss: test_env.JWT_ISSUER, aud: JWT_AUDIENCE, typ: "access" });
  });

  it("[SEC-24] logout expires both cookies with the paths they were set with", async () => {
    const { access, refresh } = await login();
    const res = await post("/auth/logout", `accessToken=${access}; refreshToken=${refresh}`);
    expect(res.status).toBe(200);

    const clearedRefresh = setCookie(res, "refreshToken");
    expect(clearedRefresh).toContain("Path=/api/v1/auth");
    expect(clearedRefresh).toContain("Max-Age=0");

    const clearedAccess = setCookie(res, "accessToken");
    expect(clearedAccess).toContain("Path=/");
    expect(clearedAccess).not.toContain("Path=/api");
    expect(clearedAccess).toContain("Max-Age=0");
  });

  it("[SEC-24] with a legacy '/' refresh cookie still present, the path-scoped one (sent first) is used", async () => {
    const { refresh } = await login();
    // Browsers list cookies with longer paths first (RFC 6265 §5.4).
    const ok = await post("/auth/refresh", `refreshToken=${refresh}; refreshToken=legacy.stale.token`);
    expect(ok.status).toBe(200);
  });
});

describe("SEC-24: token type, issuer and audience", () => {
  it("[SEC-24] a refresh-type token signed with the access key is not an access token", async () => {
    const { claims } = await login();
    const forged = await sign(test_env.SECRET_KEY, { ...identity(claims), typ: "refresh" });
    expect((await post("/auth/logout", `accessToken=${forged}`)).status).toBe(401);

    // Control: the same claims typed "access" are accepted.
    const genuine = await sign(test_env.SECRET_KEY, { ...identity(claims), typ: "access" });
    expect((await post("/auth/logout", `accessToken=${genuine}`)).status).toBe(200);
  });

  it("[SEC-24] an access-type token signed with the refresh key is not a refresh token", async () => {
    const { claims } = await login();
    const forged = await sign(test_env.REFRESH_KEY, { ...identity(claims), typ: "access" });
    expect((await post("/auth/refresh", `refreshToken=${forged}`)).status).toBe(401);
  });

  it("[SEC-24] a wrong issuer or audience is rejected even with the right key and type", async () => {
    const { claims } = await login();
    const base = { ...identity(claims), typ: "refresh" };

    const wrongIss = await sign(test_env.REFRESH_KEY, base, { iss: "someone-else" });
    expect((await post("/auth/refresh", `refreshToken=${wrongIss}`)).status).toBe(401);

    const wrongAud = await sign(test_env.REFRESH_KEY, base, { aud: "another-api" });
    expect((await post("/auth/refresh", `refreshToken=${wrongAud}`)).status).toBe(401);

    const wrongAccessIss = await sign(
      test_env.SECRET_KEY,
      { ...identity(claims), typ: "access" },
      { iss: "someone-else" },
    );
    expect((await post("/auth/logout", `accessToken=${wrongAccessIss}`)).status).toBe(401);

    // Control: correct issuer and audience → the refresh succeeds.
    const genuine = await sign(test_env.REFRESH_KEY, base);
    expect((await post("/auth/refresh", `refreshToken=${genuine}`)).status).toBe(200);
  });
});
