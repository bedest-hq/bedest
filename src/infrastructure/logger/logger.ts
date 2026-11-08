import pino, { type DestinationStream, type LoggerOptions } from "pino";
import { TEnv } from "@/common/types/TEnv";
import EnvManager from "../env/EnvManager";

/**
 * Never logged in clear [SEC-20]: credentials, session material and the
 * bound parameters of failed SQL queries (e-mails, password hashes).
 */
export const LOG_REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "headers.cookie",
  "headers.authorization",
  "password",
  "*.password",
  "currentPassword",
  "*.currentPassword",
  "newPassword",
  "*.newPassword",
  "token",
  "*.token",
  "refreshToken",
  "*.refreshToken",
  "accessToken",
  "*.accessToken",
  "err.params",
  "err.cause.params",
];

export const createLogger = (
  env: Pick<TEnv, "NODE_ENV"> & Partial<Pick<TEnv, "LOG_LEVEL">>,
  destination?: DestinationStream,
) => {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL ?? (env.NODE_ENV === "test" ? "silent" : "info"),
    redact: { paths: LOG_REDACT_PATHS, censor: "[Redacted]" },
  };

  if (destination) {
    return pino(options, destination);
  }

  if (env.NODE_ENV === "development") {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    });
  }

  return pino(options);
};

export const logger = createLogger(EnvManager.get());
