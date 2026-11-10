import { describe, it, expect } from "bun:test";
import { test_env, test_runtime_db } from "@/common/tests/TestManager.test";
import { createApp } from "./App";

describe("QLT-01: createApp builds the app without listening", () => {
  // Explicit test dependencies: the environment and a database handle.
  const app = createApp(test_env, { db: test_runtime_db });

  const get = (path: string) =>
    app.handle(new Request(`http://localhost${path}`));

  it("[QLT-01] serves health, applies the security plugins and the error envelope", async () => {
    const live = await get("/api/health/live");
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });
    expect(live.headers.get("x-content-type-options")).toBe("nosniff");

    const missing = await get("/api/v1/nowhere");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not Found" });
  });

  it("[QLT-01] mounts the v1 routes behind authentication", async () => {
    const self = await get("/api/v1/user/self");
    expect(self.status).toBe(401);
    expect(await self.json()).toEqual({ error: "Unauthorized" });
  });

  it("[QLT-01] has no server until the caller listens", () => {
    expect(app.server).toBeNull();
  });
});
