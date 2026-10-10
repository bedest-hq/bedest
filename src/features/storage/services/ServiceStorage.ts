import { SStorage } from "../schemas/SStorage";

import { status } from "elysia";
import StorageManager from "@/infrastructure/storage/StorageManager";
import { ITenantApp, ITenantUserApp, ServiceBaseTenant } from "bedest-core";

class ServiceStorage extends ServiceBaseTenant<typeof SStorage, string> {
  constructor() {
    super(SStorage);
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
    const fileExtension = data.name.includes(".")
      ? data.name.split(".").pop()
      : "bin";
    const uniqueFileName = `${crypto.randomUUID()}.${fileExtension}`;
    const key = `${c.tenantId}/${uniqueFileName}`;

    const res = await super.create(c, {
      name: data.name,
      key: key,
      mimeType: data.mimeType,
      size: data.size,
    });

    const uploadUrl = await StorageManager.getUploadUrl(key, data.mimeType);

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
