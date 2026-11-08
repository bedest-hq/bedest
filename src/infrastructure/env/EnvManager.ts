import { TEnv } from "@/common/types/TEnv";
import { VEnv } from "@/common/validations/VCommon";
import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "elysia";
import { UtilEnv } from "./UtilEnv";

export type TRawEnv = Record<string, string | undefined>;

const NODE_ENVS = ["development", "test", "production"];

export class EnvManager {
  private env: TEnv | undefined;
  private warnings: string[] = [];

  /**
   * Validates the process environment (or an injected record, for tests)
   * once and caches the result.
   */
  init(source: TRawEnv = Bun.env): TEnv {
    if (this.env) {
      return this.env;
    }

    if (!source.NODE_ENV || !NODE_ENVS.includes(source.NODE_ENV)) {
      throw new Error(
        `Env Configuration Error [NODE_ENV]: NODE_ENV is required and must be one of ${NODE_ENVS.join(", ")} (got ${source.NODE_ENV === undefined ? "nothing" : `"${source.NODE_ENV}"`}).`,
      );
    }

    // Env values are strings: convert numeric/boolean fields first, then
    // apply defaults, then validate.
    const withDefaults = Value.Default(VEnv, Value.Convert(VEnv, { ...source }));

    if (!Value.Check(VEnv, withDefaults)) {
      const firstError = [...Value.Errors(VEnv, withDefaults)][0];

      throw new Error(
        `Env Configuration Error [${firstError.path}]: ${firstError.message}`,
      );
    }

    const warnings: string[] = [];
    this.checkCors(withDefaults, warnings);

    this.warnings = warnings;
    this.env = withDefaults;
    return this.env;
  }

  private checkCors(env: TEnv, warnings: string[]) {
    if (env.CORS_ORIGIN !== undefined) {
      warnings.push(
        "CORS_ORIGIN is deprecated and will be removed in the next release; use CORS_ORIGINS (comma-separated).",
      );
    }

    if (env.NODE_ENV !== "production") {
      return;
    }

    const origins = UtilEnv.corsOrigins(env);
    if (origins.length === 0) {
      throw new Error(
        "Env Configuration Error [CORS_ORIGINS]: CORS_ORIGINS must be set explicitly in production (comma-separated list of allowed origins).",
      );
    }
    if (origins.some((origin) => origin.includes("*"))) {
      throw new Error(
        "Env Configuration Error [CORS_ORIGINS]: wildcard origins are not allowed in production.",
      );
    }
  }

  /**
   * Validates script-only variables (seed, provisioning, maintenance
   * scripts) against their own schema. They never enter the server `VEnv`.
   */
  parseScript<T extends TSchema>(
    schema: T,
    source: TRawEnv = Bun.env,
  ): Static<T> {
    const value = Value.Default(schema, Value.Convert(schema, { ...source }));
    if (!Value.Check(schema, value)) {
      const errors = [...Value.Errors(schema, value)].map(
        (e) => `[${e.path.replace(/^\//, "")}] ${e.message}`,
      );
      throw new Error(`Script Env Configuration Error: ${errors.join("; ")}`);
    }
    return value;
  }

  /** Non-fatal configuration warnings collected by the last `init()`. */
  getWarnings(): readonly string[] {
    return this.warnings;
  }

  get(): TEnv {
    if (!this.env) {
      return this.init();
    }
    return this.env;
  }
}

export default new EnvManager();
