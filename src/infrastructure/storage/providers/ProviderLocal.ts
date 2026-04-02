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
    }
  }

  async download(key: string): Promise<Blob | null> {
    const fullPath = path.join(this.basePath, key);
    const file = Bun.file(fullPath);

    try {
      const exists = await file.exists();
      if (!exists) {
        return null;
      }

      return file;
    } catch (err) {
      logger.error(
        { err, key, path: fullPath },
        "Failed to download file locally",
      );
      return null;
    }
  }
}
