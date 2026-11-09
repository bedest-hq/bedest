import { describe, it, expect, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { createTestUser } from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterUser } from "@f/user/routers/RouterUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import ServiceSession from "@f/session/services/ServiceSession";
import { RouterAuth } from "./RouterAuth";

const app = new Elysia().use(ErrorHandler).use(RouterAuth).use(RouterUser);

const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");

const login = async (email: string) => {
  const res = await app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "test_password" }),
    }),
  );
  expect(res.status).toBe(200);
  return cookiesOf(res);
};

const refresh = (cookie: string) =>
  app.handle(
    new Request("http://localhost/auth/refresh", {
      method: "POST",
      headers: { Cookie: cookie },
    }),
  );

const self = (cookie: string) =>
  app.handle(
    new Request("http://localhost/user/self", { headers: { Cookie: cookie } }),
  );

describe("SEC-09: refresh-token rotation", () => {
  it("[SEC-09] two concurrent refreshes with the same token → exactly one 200 and one 401", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const cookie = await login(user.email);

    // Make the race deterministic: whoever looks the session up first waits
    // (max 50 ms) until the other request has looked it up too. The real
    // lookup result is returned unchanged.
    const lookup = ServiceSession.find.bind(ServiceSession);
    const waiting: Array<() => void> = [];
    const barrier = spyOn(ServiceSession, "find").mockImplementation(
      async (c, id) => {
        const row = await lookup(c, id);
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length >= 2) {
            waiting.forEach((release) => release());
          } else {
            setTimeout(resolve, 50);
          }
        });
        return row;
      },
    );

    const results = await Promise.all([
      refresh(cookie),
      refresh(cookie),
    ]).finally(() => barrier.mockRestore());
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it("[SEC-09] reusing an already-rotated refresh token → 401 and the whole token family is revoked", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const original = await login(user.email);
    const otherDevice = await login(user.email);

    const rotated = await refresh(original);
    expect(rotated.status).toBe(200);
    const current = cookiesOf(rotated);
    expect((await self(current)).status).toBe(200);

    // The stolen, already-used token is presented again.
    expect((await refresh(original)).status).toBe(401);

    // Every session descending from it is gone ...
    expect((await self(current)).status).toBe(401);
    expect((await refresh(current)).status).toBe(401);
    // ... but an unrelated login of the same user is not.
    expect((await self(otherDevice)).status).toBe(200);
  });
});
