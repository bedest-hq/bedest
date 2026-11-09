import { rm } from "node:fs/promises";
import { parse, resolve } from "node:path";
import { TEnv } from "@/common/types/TEnv";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilReset, VResetEnv } from "../UtilReset";

/**
 * Deletes LOCAL_STORAGE_PATH (local provider files). Refuses in production
 * and without confirmation, and never deletes a filesystem root or the
 * working directory itself. Failures reject (the CLI exits 1) [OPS-09].
 *
 *   bun run src/scripts/storage/StorageReset.ts --yes
 *   CONFIRM_RESET=<DATABASE_NAME> bun run db:reset
 */
export async function runStorageReset(opts: {
  env: TEnv;
  argv: readonly string[];
  confirm?: string;
  cwd?: string;
}) {
  UtilReset.assertAllowed(opts.env, opts.argv, opts.confirm);

  const configured = opts.env.LOCAL_STORAGE_PATH;
  if (!configured) {
    return { removed: null };
  }
  const cwd = resolve(opts.cwd ?? process.cwd());
  const target = resolve(cwd, configured);
  if (target === parse(target).root || target === cwd) {
    throw new Error(`Refusing to delete ${target}.`);
  }
  await rm(target, { recursive: true, force: true });
  return { removed: target };
}

if (import.meta.main) {
  await UtilReset.runMain("Storage reset", async () => {
    const env = EnvManager.init();
    const { CONFIRM_RESET } = EnvManager.parseScript(VResetEnv);
    const { removed } = await runStorageReset({
      env,
      argv: process.argv.slice(2),
      confirm: CONFIRM_RESET,
    });
    process.stdout.write(
      removed
        ? `Removed ${removed}.\n`
        : "LOCAL_STORAGE_PATH not set, nothing removed.\n",
    );
  });
}
