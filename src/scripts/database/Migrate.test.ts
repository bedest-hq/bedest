import { describe, it, expect } from "bun:test";
import { sql } from "drizzle-orm";
import { test_owner_db } from "@/common/tests/TestManager.test";
import { runMigrations } from "./Migrate";

const journal = (await Bun.file("drizzle/meta/_journal.json").json()) as {
  entries: unknown[];
};

describe("Migrate", () => {
  it("[OPS-01][FEAT-02] applies the committed migrations with the runtime migrator and is idempotent", async () => {
    // TestManager already migrated this database; running again must be a
    // no-op and the migration history must match the committed journal.
    await runMigrations(test_owner_db, "drizzle");
    await runMigrations(test_owner_db, "drizzle");

    const res = await test_owner_db.execute(
      sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    );
    expect(res.rows[0]).toEqual({ n: journal.entries.length });
  });
});
