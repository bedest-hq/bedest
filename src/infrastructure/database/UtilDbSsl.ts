import { readFileSync } from "node:fs";

export type TDbSslMode = "disable" | "require" | "verify-full";

export interface IDbSslEnv {
  NODE_ENV: "development" | "test" | "production";
  DATABASE_SSL_MODE?: TDbSslMode;
  /** PEM content, or a path to a PEM file. */
  DATABASE_SSL_CA?: string;
}

export type TDbSslOptions = false | { rejectUnauthorized: boolean; ca?: string };

/**
 * The single source of the Postgres TLS options [SEC-15], used by the
 * runtime pool, script connections, the migrator and drizzle.config.ts.
 * Pure (no env access) so drizzle-kit can import it.
 */
export class UtilDbSsl {
  static mode(env: IDbSslEnv): TDbSslMode {
    return (
      env.DATABASE_SSL_MODE ??
      (env.NODE_ENV === "production" ? "verify-full" : "disable")
    );
  }

  static options(
    env: IDbSslEnv,
    readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
  ): TDbSslOptions {
    const mode = UtilDbSsl.mode(env);
    if (mode === "disable") {
      return false;
    }
    // "require" encrypts without verifying the server certificate (explicit
    // opt-in, warned about at boot); "verify-full" verifies it.
    const options: { rejectUnauthorized: boolean; ca?: string } = {
      rejectUnauthorized: mode === "verify-full",
    };
    if (env.DATABASE_SSL_CA) {
      options.ca = env.DATABASE_SSL_CA.includes("-----BEGIN")
        ? env.DATABASE_SSL_CA
        : readFile(env.DATABASE_SSL_CA);
    }
    return options;
  }
}
