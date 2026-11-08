import { SStorage } from "../schemas/SStorage";

import { status } from "elysia";
import { eq, type SQL } from "drizzle-orm";
import StorageManager from "@/infrastructure/storage/StorageManager";
import { ITenantApp, ITenantUserApp, ServiceBaseTenant } from "bedest-core";
import { EStorageStatus } from "../enums/EStorageStatus";
import { UtilStorage } from "../utils/UtilStorage";

class ServiceStorage extends ServiceBaseTenant<typeof SStorage, string> {
  constructor() {
    super(SStorage);
  }

  /** Only READY files are ever listed or served [SEC-10]. */
  protected override getFilters(id?: string): SQL[] {
    return [...super.getFilters(id), eq(SStorage.status, EStorageStatus.READY)];
  }

  async upload(c: ITenantUserApp, file: File) {
    const fileExtension = file.name.split(".").pop();
    const uniqueFileName = `${crypto.randomUUID()}.${fileExtension}`;
    const key = `${c.tenantId}/${uniqueFileName}`;

    const arrayBuffer = await file.arrayBuffer();

    await StorageManager.upload(key, arrayBuffer, file.type);

    const res = await super.create(c, {
      name: file.name,
      key: key,
      mimeType: file.type,
      size: file.size,
      status: EStorageStatus.READY,
    });

    return { id: res.id, key: key };
  }

  async get(c: ITenantApp, id: string) {
    const fileRecord = await super.getById(c, id, {
      key: SStorage.key,
      mimeType: SStorage.mimeType,
      name: SStorage.name,
    });

    if (!fileRecord) {
      throw status("Not Found");
    }

    const fileBlob = await StorageManager.download(fileRecord.key);

    if (!fileBlob) {
      throw status("Not Found");
    }

    return { fileBlob, metadata: fileRecord };
  }

  async remove(c: ITenantUserApp, id: string) {
    const fileRecord = await super.getById(c, id, {
      key: SStorage.key,
    });

    if (!fileRecord) {
      throw status("Not Found");
    }

    await StorageManager.delete(fileRecord.key);

    return await super.remove(c, id);
  }

  async presignUpload(
    c: ITenantUserApp,
    data: { name: string; mimeType: string; size: number },
  ) {
    // Same allowlist and size limit as direct uploads [SEC-10].
    if (!UtilStorage.allowedTypes().includes(data.mimeType)) {
      throw status("Bad Request", {
        message: `File type ${data.mimeType} is not allowed`,
      });
    }
    if (data.size > UtilStorage.maxBytes()) {
      throw status("Bad Request", {
        message: `File exceeds the maximum size of ${UtilStorage.maxBytes()} bytes`,
      });
    }

    const fileExtension = data.name.includes(".")
      ? data.name.split(".").pop()
      : "bin";
    const uniqueFileName = `${crypto.randomUUID()}.${fileExtension}`;
    const key = `${c.tenantId}/${uniqueFileName}`;

    // The row stays PENDING (never served) until the upload is finalized.
    const res = await super.create(c, {
      name: data.name,
      key: key,
      mimeType: data.mimeType,
      size: data.size,
      status: EStorageStatus.PENDING,
    });

    const uploadUrl = await StorageManager.getUploadUrl(
      key,
      data.mimeType,
      data.size,
    );

    return { uploadUrl, key, id: res.id };
  }

  async presignDownload(c: ITenantApp, id: string) {
    const fileRecord = await super.getById(c, id, {
      key: SStorage.key,
    });

    if (!fileRecord) {
      throw status("Not Found");
    }

    const downloadUrl = await StorageManager.getDownloadUrl(fileRecord.key);
    return { downloadUrl };
  }
}

export default new ServiceStorage();
