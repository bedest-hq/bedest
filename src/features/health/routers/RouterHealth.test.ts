import { describe, it, expect, spyOn, afterEach } from "bun:test";
import { Elysia } from "elysia";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import ServiceSystem from "@f/system/services/ServiceSystem";
import { RouterHealth } from "./RouterHealth";
import ServiceHealth from "../services/ServiceHealth";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

const app = new Elysia({ prefix: "/api" }).use(ErrorHandler).use(RouterHealth);
const get = (path: string) => app.handle(new Request(`http://localhost${path}`));

describe("FEAT-01: health endpoints", () => {
  afterEach(async () => {
    ServiceHealth.markReady();
    await ServiceSystem.setMaintenance(false);
  });

  it("[FEAT-01] GET /api/health/live → 200 { status: ok } without any I/O", async () => {
    const res = await get("/api/health/live");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("[FEAT-01] GET /api/health/ready → 200 with every check", async () => {
    // External I/O only: the object-store probe.
    const storage = spyOn(StorageManager.default, "healthCheck").mockResolvedValue("ok");
    try {
      const res = await get("/api/health/ready");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: "ok",
        checks: { db: "ok", redis: "disabled", storage: "ok" },
      });
    } finally {
      storage.mockRestore();
    }
  });

  it("[FEAT-01] a failing check → 503 naming it", async () => {
    const storage = spyOn(StorageManager.default, "healthCheck").mockRejectedValue(
      new Error("bucket unreachable"),
    );
    try {
      const res = await get("/api/health/ready");
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        status: "error",
        checks: { db: "ok", storage: "error" },
      });
    } finally {
      storage.mockRestore();
    }
  });

  it("[FEAT-01] a hanging DB probe times out and reports db: error", async () => {
    const res = await ServiceHealth.readiness(
      {
        db: () => new Promise(() => {}),
        redis: () => Promise.resolve("disabled" as const),
        storage: () => Promise.resolve("disabled" as const),
      },
      20,
    );
    expect(res).toEqual({
      status: "error",
      checks: { db: "error", redis: "disabled", storage: "disabled" },
    });
  });

  it("[FEAT-01][FEAT-03] readiness is 503 once the process is shutting down", async () => {
    ServiceHealth.markNotReady();
    const res = await get("/api/health/ready");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "error", reason: "shutting_down" });
  });

  it("[FEAT-01] health is not blocked by maintenance mode and needs no auth", async () => {
    await ServiceSystem.setMaintenance(true);
    expect((await get("/api/health/live")).status).toBe(200);
  });
});

describe("FEAT-01: mount point", () => {
  it("[FEAT-01] the application router serves /api/health/live (outside /api/v1)", async () => {
    const { createRouter } = await import("@/app/Router");
    const { test_env } = await import("@/common/tests/TestManager.test");
    const router = new Elysia().use(createRouter(test_env));
    const res = await router.handle(new Request("http://localhost/api/health/live"));
    expect(res.status).toBe(200);
  });
});
