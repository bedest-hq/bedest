import { describe, it, expect, mock } from "bun:test";
import { test_env } from "@/common/tests/TestManager.test";
import { runDatabaseReset } from "./DatabaseReset";

// The database drop itself is external I/O: replaced by a recorder.
const recorder = () => mock((): Promise<void> => Promise.resolve());

const asProcessEnv = (env: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(env)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );

describe("OPS-09: database reset guard", () => {
  it("[OPS-09] refuses with NODE_ENV=production, even with --yes and the right CONFIRM_RESET", async () => {
    const recreate = recorder();
    const err = await runDatabaseReset({
      env: { ...test_env, NODE_ENV: "production" },
      argv: ["--yes"],
      confirm: test_env.DATABASE_NAME,
      recreate,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(err)).toContain("NODE_ENV=production");
    expect(recreate).not.toHaveBeenCalled();
  });

  it("[OPS-09] refuses without --yes or a matching CONFIRM_RESET", async () => {
    const recreate = recorder();
    for (const confirm of [undefined, "", "another_db"]) {
      const err = await runDatabaseReset({ env: test_env, argv: [], confirm, recreate }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(String(err)).toContain(`CONFIRM_RESET=${test_env.DATABASE_NAME}`);
    }
    expect(recreate).not.toHaveBeenCalled();
  });

  it("[OPS-09] --yes or CONFIRM_RESET=<DATABASE_NAME> recreates the database", async () => {
    const recreate = recorder();
    await runDatabaseReset({ env: test_env, argv: ["--yes"], recreate });
    await runDatabaseReset({
      env: test_env,
      argv: [],
      confirm: test_env.DATABASE_NAME,
      recreate,
    });
    expect(recreate).toHaveBeenCalledTimes(2);
  });

  it("[OPS-09] a failing recreate rejects instead of being swallowed", async () => {
    const err = await runDatabaseReset({
      env: test_env,
      argv: ["--yes"],
      recreate: () => Promise.reject(new Error("connection refused")),
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(err)).toContain("connection refused");
  });

  it("[OPS-09] the CLI exits 1 and connects nowhere when refused", async () => {
    for (const nodeEnv of ["production", "development"]) {
      const proc = Bun.spawn(["bun", "src/scripts/database/DatabaseReset.ts"], {
        env: { ...asProcessEnv(test_env), NODE_ENV: nodeEnv, CONFIRM_RESET: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);
      expect(code).toBe(1);
      expect(stderr).toContain("Refusing to reset");
    }
  });
});
