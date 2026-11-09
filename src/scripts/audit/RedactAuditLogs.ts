import { asc, eq, gt, sql } from "drizzle-orm";
import { TDb, UtilAudit, UtilTenantScope } from "bedest-core";
import { SSystemLog } from "@f/system/schemas/SSystemLog";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilScriptDb } from "../database/UtilScriptDb";

export interface IRedactOptions {
  /** false (default) = dry run: report what would change, write nothing. */
  apply: boolean;
  batchSize?: number;
  print: (line: string) => void;
}

export interface IRedactResult {
  scanned: number;
  changed: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * One-off maintenance: rewrites existing `system_audit_logs.payload` rows
 * through the current `UtilAudit.scrub`, so values stored by older versions
 * (e.g. plaintext `currentPassword`) are redacted.
 */
export async function redactAuditLogs(
  db: TDb,
  opts: IRedactOptions,
): Promise<IRedactResult> {
  const batchSize = opts.batchSize ?? 500;
  let lastId: string | undefined;
  let scanned = 0;
  let changed = 0;

  for (;;) {
    const cursor = lastId;
    const rows = await UtilTenantScope.systemScope(db, (tx) =>
      tx
        .select({ id: SSystemLog.id, payload: SSystemLog.payload })
        .from(SSystemLog)
        .where(cursor ? gt(SSystemLog.id, cursor) : undefined)
        .orderBy(asc(SSystemLog.id))
        .limit(batchSize),
    );

    if (rows.length === 0) {
      break;
    }

    const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
    for (const row of rows) {
      const scrubbed = UtilAudit.scrub(row.payload);
      if (
        isRecord(scrubbed) &&
        JSON.stringify(scrubbed) !== JSON.stringify(row.payload)
      ) {
        updates.push({ id: row.id, payload: scrubbed });
      }
    }

    scanned += rows.length;
    changed += updates.length;

    if (opts.apply && updates.length > 0) {
      await UtilTenantScope.systemScope(db, async (tx) => {
        // Allows the rewrite once audit rows are immutable (trigger).
        await tx.execute(
          sql`SELECT set_config('app.audit_maintenance', 'on', true)`,
        );
        for (const update of updates) {
          await tx
            .update(SSystemLog)
            .set({ payload: update.payload })
            .where(eq(SSystemLog.id, update.id));
        }
      });
    }

    lastId = rows[rows.length - 1]?.id;
    if (rows.length < batchSize) {
      break;
    }
  }

  opts.print(
    `${opts.apply ? "Redacted" : "[dry-run] Would redact"} ${changed} of ${scanned} audit rows.${opts.apply ? "" : " Re-run with --apply to write."}`,
  );
  return { scanned, changed };
}

async function main() {
  const env = EnvManager.init();
  // The application role may not UPDATE audit rows [SEC-04]: run as the
  // schema owner (DATABASE_MIGRATION_USER).
  const owner = UtilScriptDb.openOwner(env);
  try {
    await redactAuditLogs(owner.db, {
      apply: process.argv.includes("--apply"),
      print: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await owner.end();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(
      `RedactAuditLogs failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
