import { UtilHttp } from "@/common/utils/UtilHttp";
import EnvManager from "@/infrastructure/env/EnvManager";
import { JWT_AUDIENCE, TJwtPayload } from "../validations/VJwtPayload";

/**
 * The refresh cookie is only sent to the auth routes (refresh, logout),
 * never to the rest of the API [SEC-24].
 */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

type TTokenType = "access" | "refresh";

export class UtilAuth {
  static cookieConf(type: TTokenType) {
    const env = EnvManager.get();

    return {
      path: type === "refresh" ? REFRESH_COOKIE_PATH : "/",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      // The refresh cookie is only used by same-site XHR calls [SEC-24].
      sameSite: type === "refresh" ? ("strict" as const) : ("lax" as const),
      maxAge: type === "access" ? 15 * 60 : 7 * 24 * 60 * 60,
    };
  }

  /**
   * Expires a cookie with the same attributes (above all the same path) it
   * was set with; a different path would leave the original in place
   * [SEC-24].
   */
  static clearedCookie(type: TTokenType) {
    return {
      ...UtilAuth.cookieConf(type),
      value: "",
      maxAge: 0,
      expires: new Date(0),
    };
  }

  /** Claims every verify checks besides signature, expiry and "typ". */
  static jwtVerifyOptions() {
    return {
      issuer: EnvManager.get().JWT_ISSUER,
      audience: JWT_AUDIENCE,
    };
  }

  /** Normalized e-mail of a (not yet validated) login body, for rate keys. */
  static rateLimitEmail(body: unknown): string {
    if (typeof body !== "object" || body === null || !("email" in body)) {
      return "";
    }
    return typeof body.email === "string"
      ? body.email.trim().toLowerCase().slice(0, 254)
      : "";
  }

  static async validateAccessToken(
    accessJwt: {
      verify: (
        token: string,
        options: { issuer: string; audience: string },
      ) => Promise<(TJwtPayload & { exp?: number }) | false>;
    },
    token: string | undefined,
  ): Promise<TJwtPayload & { exp?: number }> {
    if (!token) {
      throw UtilHttp.fail(401);
    }

    const payload = await accessJwt.verify(token, UtilAuth.jwtVerifyOptions());

    if (!payload) {
      throw UtilHttp.fail(401);
    }

    return payload;
  }
}
