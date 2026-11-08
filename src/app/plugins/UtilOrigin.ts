import { TEnv } from "@/common/types/TEnv";
import { UtilEnv } from "@/infrastructure/env/UtilEnv";

export class UtilOrigin {
  /** Origin of the request: the Origin header, else the Referer's origin. */
  static requestOrigin(request: Request): string | null {
    const origin = request.headers.get("origin");
    if (origin) {
      return origin;
    }
    const referer = request.headers.get("referer");
    if (!referer) {
      return null;
    }
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  static isAllowed(
    origin: string | null,
    env: Pick<TEnv, "CORS_ORIGINS" | "CORS_ORIGIN">,
  ): boolean {
    return origin !== null && UtilEnv.corsOrigins(env).includes(origin);
  }
}
