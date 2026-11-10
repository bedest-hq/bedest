import { InvertedStatusMap, status } from "elysia";
import type { IApiError, IApiErrorDetail } from "../types/IApiError";

const REASONS: Record<number, string | undefined> = InvertedStatusMap;

export class UtilHttp {
  /** The HTTP reason phrase of `code` ("Not Found" for 404). */
  static reason(code: number): string {
    return REASONS[code] ?? (code >= 500 ? "Internal Server Error" : "Error");
  }

  /** The error envelope for `code` [BUG-14]. */
  static envelope(
    code: number,
    message?: string,
    details?: IApiErrorDetail[],
  ): IApiError {
    const body: IApiError = { error: UtilHttp.reason(code) };
    if (message !== undefined && message !== body.error) {
      body.message = message;
    }
    if (details !== undefined) {
      body.details = details;
    }
    return body;
  }

  /**
   * An HTTP error to `throw` [BUG-14]:
   *
   *   throw UtilHttp.fail(403, "Only the uploader can delete this file");
   */
  static fail(code: number, message?: string, details?: IApiErrorDetail[]) {
    return status(code, UtilHttp.envelope(code, message, details));
  }

  /** Whether `body` already is an error envelope. */
  static isEnvelope(body: unknown): body is IApiError {
    if (typeof body !== "object" || body === null || !("error" in body)) {
      return false;
    }
    return typeof body.error === "string";
  }
}
