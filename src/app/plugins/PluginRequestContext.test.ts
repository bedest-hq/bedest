import { describe, it, expect, spyOn, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import {
  test_env,
  test_runtime_db,
  test_user,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { logger } from "@/infrastructure/logger/logger";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { createApp } from "../App";
import { PluginRequestContext } from "./PluginRequestContext";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const app = createApp(test_env, { db: test_runtime_db });

const get = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));

beforeEach(async () => {
  // Let any queued afterResponse from a previous request flush.
  await Bun.sleep(10);
});

/** The access-log entries written while `fn` ran. */
const accessLogs = async (fn: () => Promise<unknown>) => {
  const spy = spyOn(logger, "info");
  spy.mockClear();
  try {
    await fn();
    // afterResponse runs after the response is handed back.
    await Bun.sleep(5);
    return spy.mock.calls
      .filter((call) => call[1] === "request")
      .map((call) => call[0]);
  } finally {
    spy.mockRestore();
  }
};

describe("FEAT-04: request ids", () => {
  it("[FEAT-04] a valid x-request-id is echoed", async () => {
    const res = await get("/api/health/live", {
      "x-request-id": "client.req-0001",
    });
    expect(res.headers.get("x-request-id")).toBe("client.req-0001");
  });

  it("[FEAT-04] an invalid or missing x-request-id is replaced by a UUID", async () => {
    const variants: Array<Record<string, string>> = [
      { "x-request-id": "short" },
      { "x-request-id": "has spaces in it" },
      { "x-request-id": "x".repeat(129) },
      {},
    ];
    for (const headers of variants) {
      const res = await get("/api/health/live", headers);
      expect(res.headers.get("x-request-id")).toMatch(UUID_RE);
    }
  });

  it("[FEAT-04] unmatched routes get an id too", async () => {
    const res = await get("/nowhere");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toMatch(UUID_RE);
  });

  it("[FEAT-04] handlers see requestId and a child logger; 5xx bodies carry the id, 4xx do not", async () => {
    const mini = new Elysia()
      .use(PluginRequestContext)
      .use(ErrorHandler)
      .get("/id", ({ requestId, log }) => ({
        requestId,
        hasLog: typeof log.info === "function",
      }))
      .get("/boom", () => {
        throw new Error("internal detail");
      });

    const ok = await mini.handle(
      new Request("http://localhost/id", {
        headers: { "x-request-id": "trace-12345678" },
      }),
    );
    expect(await ok.json()).toEqual({
      requestId: "trace-12345678",
      hasLog: true,
    });

    const boom = await mini.handle(new Request("http://localhost/boom"));
    expect(boom.status).toBe(500);
    expect(await boom.json()).toEqual({
      error: "Internal Server Error",
      requestId: boom.headers.get("x-request-id"),
    });

    const missing = await mini.handle(new Request("http://localhost/missing"));
    expect(await missing.json()).toEqual({ error: "Not Found" });
  });
});

describe("FEAT-04: access logs", () => {
  it("[FEAT-04] one line per request with method, route pattern, status and duration — no query, cookie or body", async () => {
    const entries = await accessLogs(() =>
      get("/api/health/live?token=secret-in-query", {
        cookie: "accessToken=secret-cookie",
        "x-request-id": "access-log-0001",
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestId: "access-log-0001",
      method: "GET",
      route: "/api/health/live",
      status: 200,
      durationMs: expect.any(Number),
    });
    const line = JSON.stringify(entries[0]);
    expect(line).not.toContain("secret-in-query");
    expect(line).not.toContain("secret-cookie");
  });

  it("[FEAT-04] authenticated requests log the user (and tenant)", async () => {
    const headers = await testHeaders();
    const entries = await accessLogs(() =>
      get("/api/v1/user/self", { cookie: headers.Cookie }),
    );
    expect(entries[0]).toMatchObject({
      route: "/api/v1/user/self",
      status: 200,
      userId: test_user.id,
      tenantId: test_user.tenantId,
    });
  });
});
