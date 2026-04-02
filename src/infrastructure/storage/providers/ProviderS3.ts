import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import EnvManager from "../../env/EnvManager";
import { logger } from "../../logger/logger";
import { IProvider } from "../interfaces/IProvider";

export class ProviderS3 implements IProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const env = EnvManager.get();

    if (
      !env.S3_BUCKET ||
      !env.S3_REGION ||
      !env.S3_ACCESS_KEY ||
      !env.S3_SECRET_KEY
    ) {
      throw new Error("S3 credentials are missing in environment variables!");
    }

    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }

  async upload(
    key: string,
    body: Buffer | ArrayBuffer,
    contentType: string,
  ): Promise<void> {
    try {
      let Body: Buffer;

      if (body instanceof ArrayBuffer) {
        Body = Buffer.from(body);
      } else {
        Body = body;
      }

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body,
          ContentType: contentType,
        }),
      );

      logger.info(`File uploaded to S3 successfully: ${key}`);
    } catch (error) {
      logger.error({ err: error, key }, "Failed to upload file to S3");
      throw new Error("S3 storage upload failed", { cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      logger.info(`File deleted from S3 successfully: ${key}`);
    } catch (error) {
      logger.error({ err: error, key }, "Failed to delete file from S3");
    }
  }

  async download(key: string): Promise<Blob | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (!res.Body) {
        return null;
      }

      const bytes = await res.Body.transformToByteArray();

      return new Blob([Buffer.from(bytes)]);
    } catch (error) {
      logger.error({ err: error }, "Failed to download file.");
      return null;
    }
  }
}
