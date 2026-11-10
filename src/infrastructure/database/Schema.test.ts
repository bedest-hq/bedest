import { describe, it, expect } from "bun:test";
import { Glob } from "bun";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { test_db } from "@/common/tests/TestManager.test";

/** Every table exported by a schema module (as drizzle-kit loads them). */
const loadTables = async () => {
  const tables: PgTable[] = [];
  for await (const file of new Glob("src/features/*/schemas/*.ts").scan(".")) {
    const mod: Record<string, unknown> = await import(
      `${process.cwd()}/${file}`
    );
    for (const value of Object.values(mod)) {
      if (is(value, PgTable)) {
        tables.push(value);
      }
    }
  }
  return tables;
};

const rowsOf = (res: unknown): Array<Record<string, unknown>> =>
  typeof res === "object" &&
  res !== null &&
  "rows" in res &&
  Array.isArray(res.rows)
    ? res.rows
    : [];

describe("TST-05: schema declarations match the migrated database", () => {
  it("[TST-05] every declared index, foreign key, policy and RLS flag exists after the migrations", async () => {
    const tables = await loadTables();
    expect(tables.length).toBeGreaterThanOrEqual(11);

    for (const table of tables) {
      const config = getTableConfig(table);

      const indexRows = rowsOf(
        await test_db.execute(
          sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${config.name}`,
        ),
      ).map((r) => r.indexname);
      for (const idx of config.indexes) {
        // drizzle-kit names an unnamed index <table>_<columns>_index.
        const columns = idx.config.columns.map((c) =>
          "name" in c ? c.name : "",
        );
        const name =
          idx.config.name ?? `${config.name}_${columns.join("_")}_index`;
        expect({
          table: config.name,
          index: name,
          exists: indexRows.includes(name),
        }).toEqual({
          table: config.name,
          index: name,
          exists: true,
        });
      }

      const fkRows = rowsOf(
        await test_db.execute(
          sql`SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = ${`public.${config.name}`}::regclass`,
        ),
      ).map((r) => r.conname);
      for (const fk of config.foreignKeys) {
        const name = fk.getName();
        expect({
          table: config.name,
          foreignKey: name,
          exists: fkRows.includes(name),
        }).toEqual({
          table: config.name,
          foreignKey: name,
          exists: true,
        });
      }

      const policyRows = rowsOf(
        await test_db.execute(
          sql`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${config.name}`,
        ),
      ).map((r) => r.policyname);
      expect(policyRows.sort()).toEqual(
        config.policies.map((p) => p.name).sort(),
      );

      // RLS tables are also forced, so the schema owner is bound too [SEC-04].
      const [flags] = rowsOf(
        await test_db.execute(
          sql`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`public.${config.name}`}::regclass`,
        ),
      );
      const rls = config.enableRLS || config.policies.length > 0;
      const actual: Record<string, unknown> = { table: config.name, ...flags };
      expect(actual).toEqual({
        table: config.name,
        relrowsecurity: rls,
        relforcerowsecurity: rls,
      });
    }
  });
});
