import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterUser } from "@f/user/routers/RouterUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import {
  test_system_user,
  test_tenant,
  test_user,
  testHeaders,
  testSystemHeaders,
} from "./TestManager.test";

const app = new Elysia().use(ErrorHandler).use(RouterUser);

const selfRole = async (cookie: string) => {
  const res = await app.handle(
    new Request("http://localhost/user/self", { headers: { Cookie: cookie } }),
  );
  const body: { role: string } = await res.json();
  return body.role;
};

const seen: string[] = [];

describe("TST-01 / TST-06: test fixtures", () => {
  it("[TST-01] the default principal is a plain USER; SYSTEM is requested explicitly", async () => {
    expect(test_user.role).toBe(EUserRole.USER);
    expect(await selfRole((await testHeaders()).Cookie)).toBe(EUserRole.USER);
    expect(await selfRole((await testSystemHeaders()).Cookie)).toBe(
      EUserRole.SYSTEM,
    );
    seen.push(test_tenant.domain, test_user.email, test_system_user.email);
  });

  it("[TST-06] fixture domain and e-mails are generated per test (no fixed test.com / text@example.com)", () => {
    for (const value of [
      test_tenant.domain,
      test_user.email,
      test_system_user.email,
    ]) {
      expect(value).not.toBe("test.com");
      expect(value).not.toBe("text@example.com");
      expect(seen).not.toContain(value);
    }
  });
});
