import { Elysia, ElysiaCustomStatusResponse } from "elysia";
import { logger } from "../logger/logger";
import { UtilHttp } from "@/common/utils/UtilHttp";
import type { IApiError } from "@/common/types/IApiError";

/** Postgres SQLSTATE → client error [BUG-14]. */
const PostgresErrorMap: Record<string, { status: number; message: string }> = {
  "23505": { status: 409, message: "Resource already exists" },
  "23503": { status: 400, message: "Related record does not exist" },
  "22P02": { status: 400, message: "Invalid value" },
  "22001": { status: 400, message: "Value too long" },
  "23502": { status: 400, message: "Missing required value" },
  "40001": { status: 409, message: "Concurrent update, retry the request" },
  "40P01": { status: 409, message: "Concurrent update, retry the request" },
  "57014": { status: 503, message: "Query timed out" },
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

/** The envelope for a `status(code, body)` whose body is not one yet. */
const fromStatusBody = (code: number, body: unknown): IApiError => {
  if (UtilHttp.isEnvelope(body)) {
    return body;
  }
  if (typeof body === "string" && body.length > 0) {
    return UtilHttp.envelope(code, body);
  }
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return UtilHttp.envelope(code, body.message);
  }
  return UtilHttp.envelope(code);
};

/**
 * Every error leaves the API as `{ error, message?, details? }` [BUG-14]:
 * validation, routing, parsing, cookie and file errors, `status()` throws
 * (including bedest-core's bare ones), known Postgres errors and, last, a
 * 500 that never exposes internals.
 */
export const ErrorHandler = new Elysia({
  name: "ErrorHandler",
}).onError({ as: "global" }, ({ code, error, set }) => {
  switch (code) {
    case "VALIDATION":
      set.status = 400;
      return UtilHttp.envelope(
        400,
        "Validation failed",
        error.all.map((err) => ({
          field: err.path.replace(/^\//, ""),
          message: err.summary || err.message,
        })),
      );
    case "NOT_FOUND":
      set.status = 404;
      return UtilHttp.envelope(404);
    case "PARSE":
      set.status = 400;
      return UtilHttp.envelope(400, "Malformed request body");
    case "INVALID_COOKIE_SIGNATURE":
      set.status = 400;
      return UtilHttp.envelope(400, "Invalid cookie signature");
    case "INVALID_FILE_TYPE":
      set.status = 422;
      return UtilHttp.envelope(422, error.message);
    case "UNKNOWN":
    case "INTERNAL_SERVER_ERROR":
    default:
      break;
  }

  if (error instanceof ElysiaCustomStatusResponse) {
    const statusCode = Number(error.code);
    set.status = statusCode;
    return fromStatusBody(statusCode, error.response);
  }

  const mapped = PostgresErrorMap[getErrorCode(error) ?? ""];
  if (mapped) {
    set.status = mapped.status;
    return UtilHttp.envelope(mapped.status, mapped.message);
  }

  // pino serializes Error objects only under "err" [SEC-20].
  logger.error({ err: error }, "Internal Server Error.");

  set.status = 500;
  return UtilHttp.envelope(500);
});
