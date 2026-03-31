import EnvManager from "@/infrastructure/env/EnvManager";
import { TJwtPayload } from "../validations/VJwtPayload";
import { status } from "elysia";

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
      verify: (token: string) => Promise<TJwtPayload | false>;
    },
    token: string | undefined,
  ): Promise<TJwtPayload> {
    if (!token) {
      throw status(401, { message: "Access token missing" });
    }

    const payload = await accessJwt.verify(token);

    if (!payload) {
      throw status(401, { message: "Invalid, expired or corrupted token" });
    }

    return payload;
  }
}
