import { describe, it, expect } from "bun:test";
import { sql } from "drizzle-orm";
import { test_owner_db, test_tenant } from "@/common/tests/TestManager.test";

/**
 * EXPLAIN of the list/RLS queries with sequential scans disabled (the test
 * tables are tiny, so the planner would otherwise prefer a seq scan): each
 * must be able to use its PERF-01 index.
 */
const planOf = async (query: string) =>
  await test_owner_db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const res = await tx.execute<Record<string, string>>(
      sql.raw(`EXPLAIN ${query}`),
    );
    return res.rows.map((r) => Object.values(r).join(" ")).join("\n");
  });

describe("PERF-01: indexes for RLS predicates and list ordering", () => {
  const tenant = () => `'${test_tenant.id}'`;

  const cases: Array<[string, () => string]> = [
    [
      "idx_users_tenant",
      () =>
        `SELECT id FROM users WHERE "tenantId" = ${tenant()} AND "isDeleted" = false`,
    ],
    [
      "idx_storage_tenant_created",
      () =>
        `SELECT id FROM storage_files WHERE "tenantId" = ${tenant()} AND "isDeleted" = false ORDER BY "createdAt" DESC LIMIT 20`,
    ],
    [
      "idx_audit_logs_tenant_created",
      () =>
        `SELECT id FROM system_audit_logs WHERE "tenantId" = ${tenant()} ORDER BY "createdAt" DESC LIMIT 20`,
    ],
    [
      "idx_notifications_tenant_broadcast_created",
      () =>
        `SELECT id FROM notifications WHERE "tenantId" = ${tenant()} AND "isBroadcast" = true AND "isDeleted" = false ORDER BY "createdAt" DESC LIMIT 20`,
    ],
    [
      "idx_sessions_tenant",
      () => `SELECT id FROM sessions WHERE "tenantId" = ${tenant()}`,
    ],
    [
      "uq_notification_reads_user_notification",
      () =>
        `SELECT id FROM notification_reads WHERE "userId" = ${tenant()} AND "notificationId" = ${tenant()}`,
    ],
  ];

  for (const [index, query] of cases) {
    it(`[PERF-01] ${index}`, async () => {
      expect(await planOf(query())).toContain(index);
    });
  }
});
