import { TEnv } from "@/common/types/TEnv";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilEnv } from "@/infrastructure/env/UtilEnv";

/** Types a browser may render in place; everything else is downloaded. */
export const STORAGE_INLINE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export const STORAGE_DEFAULT_ALLOWED_TYPES = STORAGE_INLINE_TYPES.join(",");
export const STORAGE_DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

type TStorageEnv = Pick<TEnv, "STORAGE_ALLOWED_TYPES" | "STORAGE_MAX_BYTES">;

export class UtilStorage {
  /** The one allowlist used by direct uploads and presigned uploads. */
  static allowedTypes(env: TStorageEnv = EnvManager.get()): string[] {
    return UtilEnv.parseList(env.STORAGE_ALLOWED_TYPES);
  }

  static maxBytes(env: TStorageEnv = EnvManager.get()): number {
    return env.STORAGE_MAX_BYTES;
  }

  static isInline(mimeType: string): boolean {
    return STORAGE_INLINE_TYPES.includes(mimeType);
  }

  /**
   * Headers for every file response. Only inline-safe types are shown in
   * place; the sandbox CSP and nosniff stop any served content from running
   * script on the API origin.
   */
  static fileHeaders(
    metadata: { mimeType: string; name: string },
    requested: "inline" | "attachment",
  ): Record<string, string> {
    const disposition =
      requested === "inline" && UtilStorage.isInline(metadata.mimeType)
        ? "inline"
        : "attachment";
    return {
      "Content-Type": metadata.mimeType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-site",
    };
  }
}
