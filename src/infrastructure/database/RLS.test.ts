import { describe, it, expect, beforeEach } from "bun:test";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { ITenantUserApp, TDbOrTx, UtilTenantScope } from "bedest-core";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  test_owner_db,
  test_tenant,
} from "@/common/tests/TestManager.test";
import DbManager from "./DbManager";
import { STenant } from "@f/tenant/schemas/STenant";
import { SUser } from "@f/user/schemas/SUser";
import { SSession } from "@f/session/schemas/SSession";
import { SStorage } from "@f/storage/schemas/SStorage";
import {
  SNotification,
  SNotificationRead,
} from "@f/notification/schemas/SNotification";
import { SSystemLog } from "@f/system/schemas/SSystemLog";
import { SUserToken } from "@f/auth/schemas/SUserToken";
import { EUserTokenType } from "@f/auth/enums/EUserTokenType";
import { tokenHashOf } from "@f/auth/services/ServiceUserToken";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import { EUserRole } from "@f/user/enums/EUserRole";

/**
 * SEC-04: these queries run through the application connection, which in
 * tests (as in production) is the non-privileged `bedest_app` role, so RLS
 * is actually enforced. Fixtures are written by the superuser `test_db`.
 */

interface IRlsCase {
  name: string;
  table: PgTable;
  id: PgColumn;
  tenantColumn: PgColumn;
  /** Inserts a fresh row for `tenantId` and returns nothing. */
  insert: (tx: TDbOrTx, tenantId: string) => Promise<unknown>;
  /** Audit rows are append-only: UPDATE/DELETE are never granted. */
  appendOnly?: boolean;
}

let tenantB = "";
const rows: Record<string, { a: string; b: string }> = {};
let userA = "";
let userB = "";
let notifA = "";
let notifB = "";

const tenantCtx = (tenantId: string, userId: string): ITenantUserApp => ({
  db: DbManager.get(),
  nowDatetime: new Date(),
  tenantId,
  session: {
    userId,
    sessionId: crypto.randomUUID(),
    role: EUserRole.ADMIN,
    isSuperUser: false,
  },
});

const rowsOf = (res: unknown): unknown[] =>
  typeof res === "object" &&
  res !== null &&
  "rows" in res &&
  Array.isArray(res.rows)
    ? res.rows
    : [];

const errorOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return "";
  } catch (err) {
    const parts: string[] = [];
    let cur: unknown = err;
    while (cur instanceof Error) {
      parts.push(cur.message);
      cur = cur.cause;
    }
    return parts.join(" | ");
  }
};

const select = (tx: TDbOrTx, c: IRlsCase, id: string): Promise<unknown> =>
  tx.execute(sql`SELECT ${c.id} FROM ${c.table} WHERE ${c.id} = ${id}`);
const update = (tx: TDbOrTx, c: IRlsCase, id: string) =>
  tx.execute(
    sql`UPDATE ${c.table} SET ${sql.identifier(c.tenantColumn.name)} = ${c.tenantColumn} WHERE ${c.id} = ${id} RETURNING ${c.id}`,
  );
const remove = (tx: TDbOrTx, c: IRlsCase, id: string) =>
  tx.execute(
    sql`DELETE FROM ${c.table} WHERE ${c.id} = ${id} RETURNING ${c.id}`,
  );
const raw = (q: SQL) => DbManager.get().execute(q);

const CASES: IRlsCase[] = [
  {
    name: "tenants",
    table: STenant,
    id: STenant.id,
    tenantColumn: STenant.id,
    insert: (tx) =>
      tx.insert(STenant).values({
        // For tenants the row id is the tenant column, so any new id is foreign.
        id: crypto.randomUUID(),
        name: `t-${crypto.randomUUID()}`,
        domain: `${crypto.randomUUID()}.example.com`,
        country: "X",
        email: `${crypto.randomUUID()}@example.com`,
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(),
      }),
  },
  {
    name: "users",
    table: SUser,
    id: SUser.id,
    tenantColumn: SUser.tenantId,
    insert: (tx, tenantId) =>
      tx.insert(SUser).values({
        tenantId,
        name: "rls",
        email: `${crypto.randomUUID()}@example.com`,
        password: "x",
        role: EUserRole.USER,
      }),
  },
  {
    name: "sessions",
    table: SSession,
    id: SSession.id,
    tenantColumn: SSession.tenantId,
    insert: (tx, tenantId) =>
      tx.insert(SSession).values({
        tenantId,
        userId: tenantId === tenantB ? userB : userA,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
  },
  {
    name: "storage_files",
    table: SStorage,
    id: SStorage.id,
    tenantColumn: SStorage.tenantId,
    insert: (tx, tenantId) =>
      tx.insert(SStorage).values({
        tenantId,
        name: "f",
        key: `${tenantId}/${crypto.randomUUID()}`,
        mimeType: "image/png",
        size: 1,
      }),
  },
  {
    name: "notifications",
    table: SNotification,
    id: SNotification.id,
    tenantColumn: SNotification.tenantId,
    insert: (tx, tenantId) =>
      tx.insert(SNotification).values({
        tenantId,
        userId: tenantId === tenantB ? userB : userA,
        event: "rls",
      }),
  },
  {
    name: "notification_reads",
    table: SNotificationRead,
    id: SNotificationRead.id,
    tenantColumn: SNotificationRead.tenantId,
    insert: (tx, tenantId) =>
      tx.insert(SNotificationRead).values({
        tenantId,
        notificationId: tenantId === tenantB ? notifB : notifA,
        // A fresh reader: (user, notification) is unique [BUG-05].
        userId: crypto.randomUUID(),
        readAt: new Date(),
      }),
  },
  {
    // One-time account tokens [FEAT-06].
    name: "user_tokens",
    table: SUserToken,
    id: SUserToken.id,
    tenantColumn: SUserToken.tenantId,
    insert: (tx, tenantId) =>
      tx.insert(SUserToken).values({
        tenantId,
        userId: tenantId === tenantB ? userB : userA,
        type: EUserTokenType.PASSWORD_RESET,
        tokenHash: tokenHashOf(crypto.randomUUID()),
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      }),
  },
  {
    name: "system_audit_logs",
    table: SSystemLog,
    id: SSystemLog.id,
    tenantColumn: SSystemLog.tenantId,
    appendOnly: true,
    insert: (tx, tenantId) =>
      tx.insert(SSystemLog).values({
        tenantId,
        userId: tenantId === tenantB ? userB : userA,
        action: "RLS",
        entity: "rls",
        entityId: crypto.randomUUID(),
        payload: {},
      }),
  },
];

describe("SEC-04: row-level security is enforced for the application role", () => {
  beforeEach(async () => {
    const foreign = await createForeignTenant(EUserRole.USER);
    tenantB = foreign.tenant.id;
    userB = foreign.user.id;
    userA = (await createTestUser(EUserRole.USER)).user.id;

    rows.tenants = { a: test_tenant.id, b: tenantB };
    rows.users = { a: userA, b: userB };

    const insertPair = async (c: IRlsCase) => {
      const ids: string[] = [];
      for (const tenantId of [test_tenant.id, tenantB]) {
        await c.insert(test_owner_db, tenantId);
        const res = await test_db.execute(
          sql`SELECT ${c.id} AS id FROM ${c.table} WHERE ${c.tenantColumn} = ${tenantId} ORDER BY ${c.id} LIMIT 1`,
        );
        ids.push(String((rowsOf(res)[0] as { id: string }).id));
      }
      rows[c.name] = { a: ids[0], b: ids[1] };
    };

    for (const c of CASES.filter(
      (x) => x.name !== "tenants" && x.name !== "users",
    )) {
      if (c.name === "notification_reads") {
        notifA = rows.notifications.a;
        notifB = rows.notifications.b;
      }
      await insertPair(c);
    }
  });

  it("[SEC-04] the application connection is a non-superuser without BYPASSRLS", async () => {
    const res = await raw(
      sql`SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rowsOf(res)[0]).toEqual({
      role: "bedest_app",
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  for (const c of CASES) {
    it(`[SEC-04] ${c.name}: tenant A cannot read, change, delete or insert tenant B rows`, async () => {
      const { b } = rows[c.name];
      const ctx = tenantCtx(test_tenant.id, userA);

      await UtilTenantScope.tenantScope(ctx, async (tx) => {
        expect(rowsOf(await select(tx, c, b))).toHaveLength(0);
      });

      if (c.appendOnly) {
        expect(
          await errorOf(() =>
            UtilTenantScope.tenantScope(ctx, (tx) => update(tx, c, b)),
          ),
        ).toContain("permission denied");
        expect(
          await errorOf(() =>
            UtilTenantScope.tenantScope(ctx, (tx) => remove(tx, c, b)),
          ),
        ).toContain("permission denied");
      } else {
        await UtilTenantScope.tenantScope(ctx, async (tx) => {
          expect(rowsOf(await update(tx, c, b))).toHaveLength(0);
          expect(rowsOf(await remove(tx, c, b))).toHaveLength(0);
        });
      }

      expect(
        await errorOf(() =>
          UtilTenantScope.tenantScope(ctx, (tx) => c.insert(tx, tenantB)),
        ),
      ).toContain("row-level security");

      // Nothing happened to B's row.
      const check = await test_db.execute(
        sql`SELECT ${c.id} FROM ${c.table} WHERE ${c.id} = ${b}`,
      );
      expect(rowsOf(check)).toHaveLength(1);
    });

    it(`[SEC-04] ${c.name}: unscoped queries see nothing; system scope can access tenant B`, async () => {
      const { b } = rows[c.name];
      expect(
        rowsOf(await raw(sql`SELECT ${c.id} FROM ${c.table}`)),
      ).toHaveLength(0);

      await UtilTenantScope.systemScope(DbManager.get(), async (tx) => {
        expect(rowsOf(await select(tx, c, b))).toHaveLength(1);
        await c.insert(tx, tenantB);
        if (!c.appendOnly) {
          expect(rowsOf(await update(tx, c, b))).toHaveLength(1);
        }
      });

      if (!c.appendOnly && c.name !== "tenants" && c.name !== "users") {
        await UtilTenantScope.systemScope(DbManager.get(), async (tx) => {
          expect(rowsOf(await remove(tx, c, b))).toHaveLength(1);
        });
      }
    });
  }
});
