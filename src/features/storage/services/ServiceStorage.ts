import { ServiceBaseTenant } from "@/common/services/ServiceBaseTenant";
import { SStorage } from "../schemas/SStorage";

import { status } from "elysia";
import { IUserApp } from "@/common/interfaces/IContextApp";
import StorageManager from "@/infrastructure/storage/StorageManager";

class ServiceStorage extends ServiceBaseTenant<typeof SStorage, string> {
  constructor() {
    super(SStorage);
  }

  async upload(c: IUserApp, file: File) {
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

  async get(c: IUserApp, id: string) {
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

  async remove(c: IUserApp, id: string) {
    const fileRecord = await super.getById(c, id, {
      key: SStorage.key,
    });

    if (!fileRecord) {
      throw status("Not Found");
    }

    await StorageManager.delete(fileRecord.key);

    return await super.remove(c, id);
  }
}

export default new ServiceStorage();
