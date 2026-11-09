import { describe, it, expect } from "bun:test";
import { Glob } from "bun";

/**
 * Enum values are validated by the shared V* schemas only [BUG-13]; an
 * inline t.Enum(...) / t.Literal(Enum.X) copy can drift from the enum.
 */
const INLINE = /t\.Enum\((EUserRole|ETenantPlan)\)|t\.Literal\((EUserRole|ETenantPlan)\./;

describe("BUG-13: no inline enum validators", () => {
  it("[BUG-13] routes and schemas use VUserRole / VTenantPlan, VDefault is gone", async () => {
    const offenders: string[] = [];
    for await (const path of new Glob("src/**/*.ts").scan(".")) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.includes("/validations/V") && !normalized.endsWith(".test.ts")) {
        continue;
      }
      if (normalized.endsWith(".test.ts")) {
        continue;
      }
      const text = await Bun.file(path).text();
      if (INLINE.test(text) || text.includes("VDefault")) {
        offenders.push(normalized);
      }
    }
    expect(offenders).toEqual([]);
  });
});
