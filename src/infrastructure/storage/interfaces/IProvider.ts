export interface IProvider {
  upload(
    key: string,
    body: Buffer | ArrayBuffer,
    contentType: string,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  download(key: string): Promise<Blob | null>;
  getUploadUrl?(
    key: string,
    contentType: string,
    expiresIn?: number,
  ): Promise<string>;
  getDownloadUrl?(key: string, expiresIn?: number): Promise<string>;
}
