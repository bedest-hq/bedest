import { describe, it, expect } from "bun:test";
import { eq } from "drizzle-orm";
import {
  test_db,
  test_tenant,
  test_user,
} from "@/common/tests/TestManager.test";
import { SSystemLog } from "@f/system/schemas/SSystemLog";
import DbManager from "@/infrastructure/database/DbManager";
import { redactAuditLogs } from "./RedactAuditLogs";

const insertLog = async (payload: Record<string, unknown>) => {
  const [row] = await test_db
    .insert(SSystemLog)
    .values({
      tenantId: test_tenant.id,
      userId: test_user.id,
      action: "PUT",
      entity: "user",
      entityId: test_user.id,
      payload,
    })
    .returning({ id: SSystemLog.id });
  return row.id;
};

const payloadOf = async (id: string) => {
  const [row] = await test_db
    .select({ payload: SSystemLog.payload })
    .from(SSystemLog)
    .where(eq(SSystemLog.id, id));
  return row.payload;
};

describe("RedactAuditLogs", () => {
  it("[SEC-06] dry-run (default) reports but writes nothing; --apply rewrites rows in batches", async () => {
    const leaking: string[] = [];
    for (let i = 0; i < 5; i++) {
      leaking.push(
        await insertLog({ currentPassword: `old-${i}`, newPassword: `new-${i}` }),
      );
    }
    const clean = await insertLog({ name: "unchanged", statusCode: 200 });
    const lines: string[] = [];
    const db = DbManager.get();

    const dry = await redactAuditLogs(db, {
      apply: false,
      batchSize: 2,
      print: (l) => lines.push(l),
    });
    expect(dry).toEqual({ scanned: 6, changed: 5 });
    expect((await payloadOf(leaking[0])).currentPassword).toBe("old-0");
    expect(lines.join("\n")).toContain("dry-run");

    const applied = await redactAuditLogs(db, {
      apply: true,
      batchSize: 2,
      print: (l) => lines.push(l),
    });
    expect(applied).toEqual({ scanned: 6, changed: 5 });
    for (const id of leaking) {
      expect(await payloadOf(id)).toEqual({
        currentPassword: "********",
        newPassword: "********",
      });
    }
    expect(await payloadOf(clean)).toEqual({
      name: "unchanged",
      statusCode: 200,
    });

    const again = await redactAuditLogs(db, {
      apply: true,
      print: () => {},
    });
    expect(again.changed).toBe(0);
  });
});
