import EnvManager from "@/infrastructure/env/EnvManager";

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
}
