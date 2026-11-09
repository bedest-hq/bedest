import { UtilHttp } from "@/common/utils/UtilHttp";
import EnvManager from "../env/EnvManager";
import { logger } from "../logger/logger";

import { IProvider } from "./interfaces/IProvider";
import { ProviderLocal } from "./providers/ProviderLocal";
import { ProviderS3 } from "./providers/ProviderS3";

class StorageManager {
  private activeProvider: IProvider | null = null;

  constructor() {
    const env = EnvManager.get();

    if (
      env.S3_BUCKET &&
      env.S3_REGION &&
      env.S3_ACCESS_KEY &&
      env.S3_SECRET_KEY
    ) {
      this.activeProvider = new ProviderS3();
      logger.info("S3 Storage Provider enabled.");
    } else if (env.LOCAL_STORAGE_PATH) {
      this.activeProvider = new ProviderLocal(env.LOCAL_STORAGE_PATH);
      logger.info("Local Storage Provider enabled.");
    } else {
      logger.warn("No storage providers configured! File uploads will fail.");
    }
  }

  /** Whether the active provider can issue presigned URLs [BUG-04]. */
  supportsPresign(): boolean {
    return Boolean(
      this.activeProvider?.getUploadUrl && this.activeProvider.getDownloadUrl,
    );
  }

  private static notImplemented() {
    return UtilHttp.fail(
      501,
      "The active storage provider does not support presigned URLs",
    );
  }

  /** Test hook: swap the provider; returns a function restoring the old one. */
  useProviderForTesting(provider: IProvider | null) {
    const previous = this.activeProvider;
    this.activeProvider = provider;
    return () => {
      this.activeProvider = previous;
    };
  }

  /** Readiness probe: throws when the configured provider is unusable. */
  async healthCheck(): Promise<"ok" | "disabled"> {
    if (!this.activeProvider) {
      return "disabled";
    }
    await this.activeProvider.healthCheck();
    return "ok";
  }

  async upload(
    key: string,
    body: Buffer | ArrayBuffer,
    contentType: string,
  ): Promise<void> {
    if (!this.activeProvider) {
      throw UtilHttp.fail(503);
    }
    await this.activeProvider.upload(key, body, contentType);
  }

  async delete(key: string): Promise<void> {
    if (!this.activeProvider) {
      return;
    }
    await this.activeProvider.delete(key);
  }

  async download(key: string): Promise<Blob | null> {
    if (!this.activeProvider) {
      throw UtilHttp.fail(503);
    }
    return await this.activeProvider.download(key);
  }

  async getUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn = 300,
  ): Promise<string> {
    if (!this.activeProvider) {
      throw UtilHttp.fail(503);
    }
    // No fake URLs pointing at routes that do not exist [BUG-04].
    if (!this.activeProvider.getUploadUrl) {
      throw StorageManager.notImplemented();
    }
    return await this.activeProvider.getUploadUrl(
      key,
      contentType,
      contentLength,
      expiresIn,
    );
  }

  async getDownloadUrl(key: string, expiresIn = 300): Promise<string> {
    if (!this.activeProvider) {
      throw UtilHttp.fail(503);
    }
    if (!this.activeProvider.getDownloadUrl) {
      throw StorageManager.notImplemented();
    }
    return await this.activeProvider.getDownloadUrl(key, expiresIn);
  }
}

export default new StorageManager();
