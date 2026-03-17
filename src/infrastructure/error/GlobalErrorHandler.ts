import { Elysia } from "elysia";

interface PostgresError extends Error {
  code?: string;
  detail?: string;
}

interface DrizzleError extends Error {
  cause?: PostgresError;
}

export const GlobalErrorHandler = new Elysia({
  name: "GlobalErrorHandler",
}).onError({ as: "global" }, ({ code, error, set }) => {
  if (code === "VALIDATION") {
    set.status = 400;

    const formattedErrors = error.all.map((err) => ({
      field: err.path.replace("/", ""),
      message: err.summary || "Invalid value",
    }));

    return {
      error: "Validation failed",
      details: formattedErrors,
    };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "response" in error
  ) {
    set.status = error.status as number;
    return error.response;
  }

  if (error instanceof Error) {
    const dbError = error as PostgresError;
    const drizzleWrap = error as DrizzleError;

    const errorCode = dbError.code || drizzleWrap.cause?.code;

    if (errorCode === "23505") {
      set.status = 409;
      return {
        error: "Resource already exists",
        detail: "Unique constraint violation",
      };
    }

    if (errorCode === "23503") {
      set.status = 400;
      return {
        error: "Foreign key constraint failed",
        detail: "Related record does not exist",
      };
    }

    // eslint-disable-next-line no-console
    console.error("🔥 Unexpected Error:", error);

    set.status = 500;
    return {
      error: "Internal server error",
    };
  }
});
