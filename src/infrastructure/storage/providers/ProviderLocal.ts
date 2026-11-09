import path from "node:path";
import { access, constants, mkdir } from "node:fs/promises";
import { logger } from "../../logger/logger";
import { IProvider, IStoredObject } from "../interfaces/IProvider";

export class ProviderLocal implements IProvider {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /** The storage directory exists (created if needed) and is writable. */
  async healthCheck(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    await access(this.basePath, constants.W_OK);
  }

  async upload(key: string, body: Buffer | ArrayBuffer): Promise<void> {
    const fullPath = path.join(this.basePath, key);

    try {
      await Bun.write(fullPath, body);
    } catch (err) {
      logger.error(
        { err, key, path: fullPath },
        "Failed to upload file locally",
      );
      throw new Error("Local storage upload failed", { cause: err });
    }
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.basePath, key);
    const file = Bun.file(fullPath);

    try {
      const exists = await file.exists();
      if (!exists) {
        return;
      }

      await file.delete();
    } catch (err) {
      logger.error(
        { err, key, path: fullPath },
        "Failed to delete file locally",
      );
      // Propagate: the purge job decides whether to retry [BUG-03].
      throw new Error("Local storage delete failed", { cause: err });
    }
  }

  /** Streams the file; null when it does not exist, other errors throw [BUG-18]. */
  async download(key: string): Promise<IStoredObject | null> {
    const file = Bun.file(path.join(this.basePath, key));
    if (!(await file.exists())) {
      return null;
    }
    return {
      stream: file.stream(),
      contentLength: file.size,
      contentType: file.type || undefined,
    };
  }
}
