import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { UtilHttp } from "@/common/utils/UtilHttp";
import EnvManager from "../../env/EnvManager";
import { logger } from "../../logger/logger";
import { IProvider, IStoredObject } from "../interfaces/IProvider";

/** "No such object": NoSuchKey / NotFound or any HTTP 404 [BUG-18]. */
const isNotFound = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (
    "name" in error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")
  ) {
    return true;
  }
  return (
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    error.$metadata.httpStatusCode === 404
  );
};

export class ProviderS3 implements IProvider {
  private client: S3Client;
  private bucket: string;
  /** Addressing style of a client built from the env [BUG-18]. */
  readonly pathStyle: boolean;

  /** `client` is injectable for tests (its network call is mocked). */
  constructor(deps: { client?: S3Client } = {}) {
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
    this.pathStyle = env.S3_FORCE_PATH_STYLE;
    this.client =
      deps.client ??
      new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        },
        // Configurable: path-style for MinIO, virtual-hosted for AWS [BUG-18].
        forcePathStyle: this.pathStyle,
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
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body instanceof ArrayBuffer ? Buffer.from(body) : body,
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
      // Propagate: the purge job decides whether to retry [BUG-03].
      throw new Error("S3 storage delete failed", { cause: error });
    }
  }

  /**
   * Streams the object (never reads it into memory). A missing object is
   * null (404); any other failure is a 502, not a fake "not found"
   * [BUG-18].
   */
  async download(key: string): Promise<IStoredObject | null> {
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

      return {
        stream: res.Body.transformToWebStream(),
        contentLength: res.ContentLength,
        contentType: res.ContentType,
        etag: res.ETag,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      logger.error({ err: error, key }, "Failed to download file from S3");
      throw UtilHttp.fail(502, "Storage backend error");
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
    // No casts: client-s3 and s3-request-presigner share one version [BUG-18].
    return await getSignedUrl(this.client, command, {
      expiresIn,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
  }

  async getDownloadUrl(key: string, expiresIn = 300): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await getSignedUrl(this.client, command, { expiresIn });
  }
}
