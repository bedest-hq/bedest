/** A stored object, streamed (never buffered in memory) [BUG-18]. */
export interface IStoredObject {
  stream: ReadableStream<Uint8Array>;
  /** Size in bytes, when the backend reports it. */
  contentLength?: number;
  contentType?: string;
  etag?: string;
}

export interface IProvider {
  /** Throws when the backend is not usable (readiness probe). */
  healthCheck(): Promise<void>;
  upload(
    key: string,
    body: Buffer | ArrayBuffer,
    contentType: string,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  /** null when the object does not exist; other failures throw [BUG-18]. */
  download(key: string): Promise<IStoredObject | null>;
  getUploadUrl?(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn?: number,
  ): Promise<string>;
  getDownloadUrl?(key: string, expiresIn?: number): Promise<string>;
}
