import { Elysia } from "elysia";
import { logger } from "../logger/logger";

const PostgresErrorMap: Record<
  string,
  { status: number; error: string; detail: string }
> = {
  "23505": {
    status: 409,
    error: "Resource already exists",
    detail: "Unique constraint violation",
  },
  "23503": {
    status: 400,
    error: "Foreign key constraint failed",
    detail: "Related record does not exist",
  },
};

const getErrorCode = (e: unknown): string | undefined => {
  if (typeof e !== "object" || e === null) {
    return undefined;
  }
  if ("code" in e && typeof e.code === "string") {
    return e.code;
  }
  if ("cause" in e) {
    return getErrorCode(e.cause);
  }
  if ("error" in e) {
    return getErrorCode(e.error);
  }
  return undefined;
};

export const ErrorHandler = new Elysia({
  name: "ErrorHandler",
}).onError({ as: "global" }, ({ code, error, set }) => {
  if (code === "VALIDATION") {
    set.status = 400;
    return {
      error: "Validation failed",
      details: error.all.map((err) => ({
        field: err.path.replace(/^\//, ""),
        message: err.summary || err.message,
      })),
    };
  }

  if (code !== "UNKNOWN" || !(error instanceof Error)) {
    return;
  }

  const mapped = PostgresErrorMap[getErrorCode(error) ?? ""];

  if (mapped) {
    set.status = mapped.status;
    return {
      error: mapped.error,
      detail: mapped.detail,
    };
  }

  logger.error({ error }, "Internal Server Error.");

  set.status = 500;
  return {
    error: "Internal server error",
  };
});
