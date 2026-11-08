import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { testHeaders } from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterAuth } from "@f/auth/routers/RouterAuth";
import { RouterUser } from "./RouterUser";
import { EUserRole } from "../enums/EUserRole";

const app = new Elysia().use(ErrorHandler).use(RouterAuth).use(RouterUser);

const json = (method: string, path: string, body: unknown, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const createUser = async (email: string) =>
  json(
    "POST",
    "/user",
    { name: "E-mail Test", email, role: EUserRole.USER, password: "a-strong-password-1" },
    (await testHeaders()).Cookie,
  );

describe("SEC-21: e-mail addresses are validated and normalized", () => {
  it("[SEC-21] A@X.com then a@x.com → 409", async () => {
    const id = crypto.randomUUID().slice(0, 8);
    expect((await createUser(`Alice.${id}@Example.COM`)).status).toBe(200);
    expect((await createUser(`alice.${id}@example.com`)).status).toBe(409);
  });

  it("[SEC-21] login with a different letter case succeeds", async () => {
    const id = crypto.randomUUID().slice(0, 8);
    expect((await createUser(`bob.${id}@example.com`)).status).toBe(200);
    const res = await json("POST", "/auth/login", {
      email: `BOB.${id}@EXAMPLE.com`,
      password: "a-strong-password-1",
    });
    expect(res.status).toBe(200);
  });

  it("[SEC-21] an invalid or over-long e-mail → 400", async () => {
    expect((await createUser("not-an-email")).status).toBe(400);
    expect((await createUser(`${"a".repeat(250)}@x.io`)).status).toBe(400);
  });
});
