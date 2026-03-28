import EnvManager from "@/infrastructure/env/EnvManager";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

export class UtilAuth {
  static cookieConf(type: "access" | "refresh") {
    const env = EnvManager.get();

    return {
      path: "/",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: type === "access" ? 15 * 60 : 7 * 24 * 60 * 60,
    };
  }

  static async validateAccessToken(
    accessJwt: {
      verify: (token: string) => Promise<Record<string, unknown> | false>;
    },
    token: string | undefined,
  ): Promise<{
    tenantId: string;
    userId: string;
    sessionId: string;
    role: string;
  }> {
    if (!token) {
      throw ErrorHandler.unauthorized("Access token missing");
    }

    const payload = await accessJwt.verify(token);

    if (!payload) {
      throw ErrorHandler.unauthorized("Unauthorized");
    }

    const { tenantId, userId, sessionId, role } = payload;

    if (!tenantId || !userId || !sessionId || !role) {
      throw ErrorHandler.unauthorized("Invalid token payload");
    }

    return {
      tenantId: String(tenantId),
      userId: String(userId),
      sessionId: String(sessionId),
      role: String(role),
    };
  }
}
