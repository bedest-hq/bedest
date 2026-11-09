/**
 * Child-process fixture for RouterAuth.test.ts [SEC-01]: imports the auth
 * router fresh under the NODE_ENV of this process (as at server start) and
 * posts logins without credentials. Prints one JSON line with the status
 * and the number of Set-Cookie headers of each answer. Running it in its
 * own process keeps the test's module graph (and coverage) untouched.
 */
import { Elysia } from "elysia";
import EnvManager from "@/infrastructure/env/EnvManager";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import DbManager from "@/infrastructure/database/DbManager";

// A pool object only: requests rejected by validation never query it.
DbManager.init(EnvManager.init());
const { RouterAuth } = await import("@f/auth/routers/RouterAuth");
const app = new Elysia().use(ErrorHandler).use(RouterAuth);

const results: Array<{ status: number; cookies: number }> = [];
for (const body of [{}, { email: "someone@example.com" }]) {
  const res = await app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  results.push({
    status: res.status,
    cookies: res.headers.getSetCookie().length,
  });
}
await DbManager.shutdown();
process.stdout.write(`${JSON.stringify(results)}
`);
