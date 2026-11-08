import { TEnv } from "@/common/types/TEnv";
import { VEnv } from "@/common/validations/VCommon";
import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "elysia";
import { UtilEnv } from "./UtilEnv";

export type TRawEnv = Record<string, string | undefined>;

const NODE_ENVS = ["development", "test", "production"];

/**
 * Values shipped in .env.example. They are fine for local development but
 * must never reach production [SEC-16].
 */
const PLACEHOLDERS: ReadonlyArray<{
  name: "SECRET_KEY" | "REFRESH_KEY" | "DATABASE_PASSWORD";
  values: readonly string[];
}> = [
  {
    name: "SECRET_KEY",
    values: [
      "change-me-access-secret-at-least-32-characters",
      "super-secret-key",
    ],
  },
  {
    name: "REFRESH_KEY",
    values: [
      "change-me-refresh-secret-at-least-32-characters",
      "super-secret-refresh-key",
    ],
  },
  { name: "DATABASE_PASSWORD", values: ["change-me"] },
];

const formatErrors = (errors: string[]) =>
  `Env Configuration Error:\n${errors.map((e) => `  - ${e}`).join("\n")}`;

export class EnvManager {
  private env: TEnv | undefined;
  private warnings: string[] = [];

  /**
   * Validates the process environment (or an injected record, for tests)
   * once and caches the result. Values are converted (numbers, booleans),
   * defaulted and validated; every problem is reported in one error.
   */
  init(source: TRawEnv = Bun.env): TEnv {
    if (this.env) {
      return this.env;
    }

    const errors: string[] = [];
    if (!source.NODE_ENV || !NODE_ENVS.includes(source.NODE_ENV)) {
      errors.push(
        `[NODE_ENV] NODE_ENV is required and must be one of ${NODE_ENVS.join(", ")} (got ${source.NODE_ENV === undefined ? "nothing" : `"${source.NODE_ENV}"`}).`,
      );
    }

    // Env values are strings: convert numeric/boolean fields first, then
    // apply defaults, then validate.
    const value = Value.Default(VEnv, Value.Convert(VEnv, { ...source }));

    if (!Value.Check(VEnv, value)) {
      const seen = new Set<string>();
      for (const e of Value.Errors(VEnv, value)) {
        const path = e.path.replace(/^\//, "") || "(root)";
        if (path === "NODE_ENV" || seen.has(path)) {
          continue;
        }
        seen.add(path);
        errors.push(`[${path}] ${e.message}`);
      }
      throw new Error(formatErrors(errors));
    }
    if (errors.length > 0) {
      throw new Error(formatErrors(errors));
    }

    const warnings: string[] = [];
    if (source.DATABASE_SSL !== undefined) {
      warnings.push(
        "DATABASE_SSL is no longer read; use DATABASE_SSL_MODE (disable | require | verify-full).",
      );
    }
    errors.push(...this.semanticErrors(value, warnings));
    if (errors.length > 0) {
      throw new Error(formatErrors(errors));
    }

    this.warnings = warnings;
    this.env = value;
    return this.env;
  }

  /** Rules a schema cannot express. */
  private semanticErrors(env: TEnv, warnings: string[]): string[] {
    const errors: string[] = [];

    if (env.SECRET_KEY === env.REFRESH_KEY) {
      errors.push("[REFRESH_KEY] SECRET_KEY and REFRESH_KEY must differ.");
    }

    if (env.DATABASE_SSL_MODE === "require") {
      warnings.push(
        "DATABASE_SSL_MODE=require encrypts the database connection but does not verify the server certificate; prefer verify-full (with DATABASE_SSL_CA).",
      );
    }

    if (env.CORS_ORIGIN !== undefined) {
      warnings.push(
        "CORS_ORIGIN is deprecated and will be removed in the next release; use CORS_ORIGINS (comma-separated).",
      );
    }

    if (env.NODE_ENV !== "production") {
      return errors;
    }

    const origins = UtilEnv.corsOrigins(env);
    if (origins.length === 0) {
      errors.push(
        "[CORS_ORIGINS] CORS_ORIGINS must be set explicitly in production (comma-separated list of allowed origins).",
      );
    }
    if (origins.some((origin) => origin.includes("*"))) {
      errors.push(
        "[CORS_ORIGINS] wildcard origins are not allowed in production.",
      );
    }

    for (const { name, values } of PLACEHOLDERS) {
      if (values.includes(env[name])) {
        errors.push(
          `[${name}] still has the .env.example placeholder value; set a real secret in production.`,
        );
      }
    }

    return errors;
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
