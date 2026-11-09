import type { IStoredObject } from "@/infrastructure/storage/interfaces/IProvider";
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

export type TStorageEnv = Pick<
  TEnv,
  "STORAGE_ALLOWED_TYPES" | "STORAGE_MAX_BYTES"
>;

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
  /**
   * A streaming response for a stored object: the hardened file headers
   * plus Content-Length and ETag when known; nothing is buffered [BUG-18].
   */
  static fileResponse(
    object: IStoredObject,
    metadata: { mimeType: string; name: string },
    requested: "inline" | "attachment",
  ): Response {
    const headers = new Headers(UtilStorage.fileHeaders(metadata, requested));
    if (object.contentLength !== undefined) {
      headers.set("Content-Length", String(object.contentLength));
    }
    if (object.etag) {
      headers.set("ETag", object.etag);
    }
    return new Response(object.stream, { headers });
  }

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

/** Object key extensions come from the (allowlisted) MIME type only [BUG-03]. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const storageExtensionFor = (mimeType: string): string =>
  EXTENSIONS[mimeType] ?? "bin";
