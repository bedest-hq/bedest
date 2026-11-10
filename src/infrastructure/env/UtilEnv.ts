import { TEnv } from "@/common/types/TEnv";

export class UtilEnv {
  /** Comma-separated list → trimmed, non-empty origins. */
  static parseList(value: string | undefined): string[] {
    return (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  /**
   * Allowed browser origins. `CORS_ORIGINS` wins; the deprecated
   * `CORS_ORIGIN` is still read for one release.
   */
  static corsOrigins(
    env: Pick<TEnv, "CORS_ORIGINS" | "CORS_ORIGIN">,
  ): string[] {
    const list = UtilEnv.parseList(env.CORS_ORIGINS);
    if (list.length > 0) {
      return list;
    }
    return UtilEnv.parseList(env.CORS_ORIGIN);
  }

  /** An absolute http(s) URL without query or fragment [FEAT-06]. */
  static isHttpUrl(value: string): boolean {
    if (!URL.canParse(value)) {
      return false;
    }
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.search === "" &&
      url.hash === ""
    );
  }
}
