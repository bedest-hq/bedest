export class UtilAudit {
  private static readonly SENSITIVE_KEYS = new Set([
    "password",
    "accessToken",
    "refreshToken",
    "token",
  ]);

  private static readonly MAX_DEPTH = 5;

  static scrub(data: unknown, currentDepth = 0): unknown {
    if (currentDepth > this.MAX_DEPTH) {
      return "[MAX_DEPTH_REACHED]";
    }

    if (typeof data !== "object" || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.scrub(item, currentDepth + 1));
    }

    if (data instanceof Blob) {
      const fileName = data instanceof File ? data.name : "unknown_blob";
      return `[FILE/BLOB: ${fileName}]`;
    }

    const scrubbed: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (this.SENSITIVE_KEYS.has(key)) {
        scrubbed[key] = "********";
      } else {
        scrubbed[key] = this.scrub(value, currentDepth + 1);
      }
    }

    return scrubbed;
  }
}
