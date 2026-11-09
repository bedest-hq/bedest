import { t } from "elysia";
import { TEnv } from "@/common/types/TEnv";

/**
 * Script-only confirmation for destructive resets [OPS-09]. Never read by
 * the server.
 */
export const VResetEnv = t.Object({
  // Must equal DATABASE_NAME to confirm a reset without `--yes`.
  CONFIRM_RESET: t.Optional(t.String()),
});

export class UtilReset {
  /**
   * Throws unless a destructive reset is allowed: never with
   * NODE_ENV=production, otherwise only with `--yes` or
   * CONFIRM_RESET=<DATABASE_NAME> [OPS-09].
   */
  static assertAllowed(
    env: TEnv,
    argv: readonly string[],
    confirm: string | undefined,
  ) {
    if (env.NODE_ENV === "production") {
      throw new Error("Refusing to reset with NODE_ENV=production.");
    }
    if (argv.includes("--yes")) {
      return;
    }
    if (confirm !== undefined && confirm === env.DATABASE_NAME) {
      return;
    }
    throw new Error(
      `Refusing to reset without confirmation: pass --yes or set CONFIRM_RESET=${env.DATABASE_NAME}.`,
    );
  }

  /** Runs a script's main(), printing the error and exiting 1 on failure. */
  static async runMain(name: string, main: () => Promise<void>) {
    try {
      await main();
    } catch (err) {
      process.stderr.write(
        `${name} failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  }
}
