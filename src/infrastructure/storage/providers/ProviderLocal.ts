import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { logger } from "../../logger/logger";
import { IProvider } from "../interfaces/IProvider";

export class ProviderLocal implements IProvider {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async upload(key: string, body: Buffer | ArrayBuffer): Promise<void> {
    const fullPath = path.join(this.basePath, key);
    const dir = path.dirname(fullPath);

    const dirError = await mkdir(dir, { recursive: true })
      .then(() => null)
      .catch((e) => e as Error);

    if (dirError) {
      logger.error(
        { err: dirError, key },
        "Failed to create directory locally",
      );
      throw new Error("Local storage directory creation failed", {
        cause: dirError,
      });
    }

    const writeError = await Bun.write(fullPath, body)
      .then(() => null)
      .catch((e) => e as Error);

    if (writeError) {
      logger.error({ err: writeError, key }, "Failed to upload file locally");
      throw new Error("Local storage upload failed", { cause: writeError });
    }

    logger.info(`File uploaded locally: ${fullPath}`);
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.basePath, key);
    const file = Bun.file(fullPath);

    const exists = await file.exists().catch(() => false);
    if (!exists) {
      return;
    }

    const unlinkError = await unlink(fullPath)
      .then(() => null)
      .catch((e) => e as Error);

    if (unlinkError) {
      logger.error({ err: unlinkError, key }, "Failed to delete file locally");
      return;
    }

    logger.info(`File deleted locally: ${fullPath}`);
  }

  async download(key: string): Promise<Blob | null> {
    const fullPath = path.join(this.basePath, key);
    const file = Bun.file(fullPath);

    const exists = await file.exists().catch(() => false);
    if (!exists) {
      return null;
    }

    return file;
  }
}
