import EnvManager from "../env/EnvManager";
import { logger } from "../logger/logger";
import { status } from "elysia";
import { IProvider } from "./interfaces/IProvider";
import { ProviderLocal } from "./providers/ProviderLocal";
import { ProviderS3 } from "./providers/ProviderS3";

class StorageManager {
  private providers: IProvider[] = [];

  constructor() {
    const env = EnvManager.get();

    if (env.LOCAL_STORAGE_PATH) {
      this.providers.push(new ProviderLocal(env.LOCAL_STORAGE_PATH));
      logger.info("Local Storage Provider enabled.");
    }

    if (
      env.S3_BUCKET &&
      env.S3_REGION &&
      env.S3_ACCESS_KEY &&
      env.S3_SECRET_KEY &&
      env.S3_ENDPOINT
    ) {
      this.providers.push(new ProviderS3());
      logger.info("S3 Storage Provider enabled.");
    }

    if (this.providers.length === 0) {
      logger.warn("No storage providers configured! File uploads will fail.");
    }
  }

  async upload(
    key: string,
    body: Buffer | ArrayBuffer,
    contentType: string,
  ): Promise<void> {
    if (this.providers.length === 0) {
      logger.error("Storage upload attempted but storage service is disabled.");

      throw status("Service Unavailable");
    }

    await Promise.all(
      this.providers.map((provider) => provider.upload(key, body, contentType)),
    );
  }

  async delete(key: string): Promise<void> {
    if (this.providers.length === 0) {
      return;
    }

    await Promise.all(this.providers.map((provider) => provider.delete(key)));
  }

  async download(key: string): Promise<Blob | null> {
    if (this.providers.length === 0) {
      throw status("Service Unavailable");
    }

    return await this.providers[0].download(key);
  }
}

export default new StorageManager();
