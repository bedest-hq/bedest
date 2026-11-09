import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import {
  createForeignTenant,
  test_db,
  test_tenant,
  test_user,
  testSystemHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { EUserRole } from "@f/user/enums/EUserRole";
import { RouterSystemLog } from "@f/system/routers/RouterSystemLog";
import { RouterNotification } from "@f/notification/routers/RouterNotification";
import { UtilCursor } from "@/common/utils/UtilCursor";

const app = new Elysia()
  .use(ErrorHandler)
  .use(RouterSystemLog)
  .use(RouterNotification);

const get = async (path: string, cookie: string) => {
  const res = await app.handle(
    new Request(`http://localhost${path}`, { headers: { Cookie: cookie } }),
  );
  return { status: res.status, body: await res.json() };
};

/** createdAt values: two share a timestamp, two differ only in µs. */
const STAMPS = [
  "2026-01-05 00:00:00.000002+00",
  "2026-01-05 00:00:00.000001+00",
  "2026-01-04 00:00:00+00",
  "2026-01-04 00:00:00+00",
  "2026-01-03 00:00:00+00",
];

/** Follows nextCursor from page 1 to the end, collecting ids. */
const walk = async (base: string, cookie: string) => {
  const ids: string[] = [];
  let res = await get(`${base}&limit=2&page=1`, cookie);
  expect(res.status).toBe(200);
  expect(res.body.meta).toMatchObject({ total: 5, page: 1, totalPages: 3 });
  ids.push(...res.body.data.map((r: { id: string }) => r.id));
  while (res.body.meta.nextCursor) {
    res = await get(
      `${base}&limit=2&cursor=${res.body.meta.nextCursor}`,
      cookie,
    );
    expect(res.status).toBe(200);
    // Keyset mode skips the COUNT.
    expect(res.body.meta.total).toBeUndefined();
    ids.push(...res.body.data.map((r: { id: string }) => r.id));
  }
  return ids;
};

const expectedOrder = (rows: Array<{ id: string; createdAt: string }>) =>
  [...rows]
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? b.id.localeCompare(a.id)
        : b.createdAt.localeCompare(a.createdAt),
    )
    .map((r) => r.id);

describe("PERF-02: cursor pagination", () => {
  it("[PERF-02] GET /system/log walks every row once, in order, across µs-precise and tied timestamps", async () => {
    const action = `PERF02_${crypto.randomUUID().slice(0, 8)}`;
    const rows = STAMPS.map((createdAt) => ({
      id: crypto.randomUUID(),
      createdAt,
    }));
    for (const row of rows) {
      await test_db.execute(sql`
        INSERT INTO system_audit_logs (id, "tenantId", "userId", action, entity, payload, "createdAt")
        VALUES (${row.id}, ${test_tenant.id}, ${test_user.id}, ${action}, 'perf', '{}'::jsonb, ${row.createdAt}::timestamptz)
      `);
    }
    const cookie = (await testSystemHeaders()).Cookie;
    const ids = await walk(`/log?action=${action}`, cookie);
    expect(ids).toEqual(expectedOrder(rows));
  });

  it("[PERF-02] GET /notifications walks every row once, in order", async () => {
    const reader = await createForeignTenant(EUserRole.USER);
    const rows = STAMPS.map((createdAt) => ({
      id: crypto.randomUUID(),
      createdAt,
    }));
    for (const row of rows) {
      await test_db.execute(sql`
        INSERT INTO notifications (id, "tenantId", "userId", "isBroadcast", event, payload, "createdAt")
        VALUES (${row.id}, ${reader.tenant.id}, ${reader.user.id}, false, 'perf', '{}'::jsonb, ${row.createdAt}::timestamptz)
      `);
    }
    const ids = await walk(
      "/notifications?unreadOnly=false",
      reader.headers.Cookie,
    );
    expect(ids).toEqual(expectedOrder(rows));
  });

  it("[PERF-02] a malformed cursor → 400 'Invalid cursor'", async () => {
    const cookie = (await testSystemHeaders()).Cookie;
    for (const cursor of [
      "not-base64!",
      UtilCursor.encode({ createdAt: "yesterday", id: "x" }),
    ]) {
      const res = await get(
        `/log?cursor=${encodeURIComponent(cursor)}`,
        cookie,
      );
      expect(res).toEqual({
        status: 400,
        body: { error: "Bad Request", message: "Invalid cursor" },
      });
    }
  });

  it("[PERF-02] encode/decode round-trip keeps microseconds", () => {
    const cursor = {
      createdAt: "2026-01-05T00:00:00.000002Z",
      id: crypto.randomUUID(),
    };
    expect(UtilCursor.decode(UtilCursor.encode(cursor))).toEqual(cursor);
  });
});
