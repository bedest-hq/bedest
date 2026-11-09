import { describe, it, expect } from "bun:test";
import { sql } from "drizzle-orm";
import { test_db, test_user } from "@/common/tests/TestManager.test";

/** Inserts an audit row as the schema owner (superuser test handle). */
const insertRow = async () => {
  const id = crypto.randomUUID();
  await test_db.execute(sql`
    INSERT INTO system_audit_logs (id, "tenantId", "userId", action, entity, payload)
    SELECT ${id}, ${test_user.tenantId}, ${test_user.id}, 'TEST', 'test', '{}'::jsonb
  `);
  return id;
};

/** The Postgres message of a failed query (drizzle puts it on `cause`). */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => "no error",
    (e: unknown) =>
      typeof e === "object" &&
      e !== null &&
      "cause" in e &&
      e.cause instanceof Error
        ? e.cause.message
        : String(e),
  );

const payloadOf = async (id: string) => {
  const res = await test_db.execute<{ payload: Record<string, unknown> }>(
    sql`SELECT payload FROM system_audit_logs WHERE id = ${id}`,
  );
  return res.rows[0]?.payload;
};

describe("FEAT-13: audit log immutability", () => {
  it("[FEAT-13] UPDATE is refused even for the schema owner", async () => {
    const id = await insertRow();
    const err = await failure(
      test_db.execute(
        sql`UPDATE system_audit_logs SET payload = '{"x":1}'::jsonb WHERE id = ${id}`,
      ),
    );
    expect(err).toContain("append-only");
    expect(await payloadOf(id)).toEqual({});
  });

  it("[FEAT-13] DELETE is refused even for the schema owner", async () => {
    const id = await insertRow();
    const err = await failure(
      test_db.execute(sql`DELETE FROM system_audit_logs WHERE id = ${id}`),
    );
    expect(err).toContain("append-only");
    expect(await payloadOf(id)).toEqual({});
  });

  it("[FEAT-13] maintenance transactions (app.audit_maintenance = on) may rewrite rows", async () => {
    const id = await insertRow();
    await test_db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.audit_maintenance', 'on', true)`,
      );
      await tx.execute(
        sql`UPDATE system_audit_logs SET payload = '{"redacted":true}'::jsonb WHERE id = ${id}`,
      );
    });
    expect(await payloadOf(id)).toEqual({ redacted: true });
  });

  it("[FEAT-13] the flag is transaction-local", async () => {
    const id = await insertRow();
    await test_db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.audit_maintenance', 'on', true)`,
      );
    });
    const err = await failure(
      test_db.execute(sql`DELETE FROM system_audit_logs WHERE id = ${id}`),
    );
    expect(err).toContain("append-only");
  });
});
