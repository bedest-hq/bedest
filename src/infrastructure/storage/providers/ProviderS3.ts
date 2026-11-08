import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

  /** HEAD the bucket (2 s timeout). */
  async healthCheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(2000),
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

  /**
   * Presigned PUT that binds the declared type and size: Content-Type and
   * Content-Length are part of the signature, so the client cannot upload a
   * different type or more bytes than declared [SEC-10].
   */
  async getUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn = 300,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    return await getSignedUrl(
      this.client as unknown as Parameters<typeof getSignedUrl>[0],
      command as unknown as Parameters<typeof getSignedUrl>[1],
      {
        expiresIn,
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );
  }

  async getDownloadUrl(key: string, expiresIn = 300): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await getSignedUrl(
      this.client as unknown as Parameters<typeof getSignedUrl>[0],
      command as unknown as Parameters<typeof getSignedUrl>[1],
      { expiresIn },
    );
  }
}
