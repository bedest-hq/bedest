export class UtilAuth {
  static cookieConf(type: "access" | "refresh") {
    return {
      path: "/",
      httpOnly: true,
      secure: Bun.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: type === "access" ? 15 * 60 : 7 * 24 * 60 * 60,
    };
  }
}
