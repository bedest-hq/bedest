import { SStorage } from "../schemas/SStorage";

import { status } from "elysia";
import { and, eq, type SQL } from "drizzle-orm";
import StorageManager from "@/infrastructure/storage/StorageManager";
import {
  IApp,
  ITenantApp,
  ITenantUserApp,
  ServiceBaseTenant,
  UtilTenantScope,
} from "bedest-core";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SUser } from "@f/user/schemas/SUser";
import { STenant } from "@f/tenant/schemas/STenant";
import { EStorageStatus } from "../enums/EStorageStatus";
import { storageExtensionFor, UtilStorage } from "../utils/UtilStorage";

class ServiceStorage extends ServiceBaseTenant<typeof SStorage, string> {
  constructor() {
    super(SStorage);
  }

  /** Only READY files are ever listed or served [SEC-10]. */
  protected override getFilters(c: ITenantApp, id?: string): SQL[] {
    return [
      ...super.getFilters(c, id),
      eq(SStorage.status, EStorageStatus.READY),
    ];
  }

  /** Hard-deletes a row that never became READY (its object never existed). */
  private async discardPending(c: ITenantUserApp, id: string) {
    await UtilTenantScope.tenantScope(c, (tx) =>
      tx
        .delete(SStorage)
        .where(
          and(eq(SStorage.id, id), eq(SStorage.status, EStorageStatus.PENDING)),
        ),
    );
  }

  /**
   * Row first (PENDING), then the object, then READY [BUG-03]: a failed
   * object write removes the row, a failed row insert never writes an
   * object. The key extension comes from the MIME type, not the file name.
   */
  async upload(c: ITenantUserApp, file: File) {
    const key = `${c.tenantId}/${crypto.randomUUID()}.${storageExtensionFor(file.type)}`;

    const res = await super.create(c, {
      name: file.name,
      key: key,
      mimeType: file.type,
      size: file.size,
      status: EStorageStatus.PENDING,
      uploadedBy: c.session.userId,
    });

    try {
      await StorageManager.upload(key, await file.arrayBuffer(), file.type);
    } catch (err) {
      await this.discardPending(c, res.id);
      throw err;
    }

    await UtilTenantScope.tenantScope(c, (tx) =>
      tx
        .update(SStorage)
        .set({ status: EStorageStatus.READY })
        .where(eq(SStorage.id, res.id)),
    );

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

  /**
   * Only the uploader or an ADMIN/SYSTEM user may delete a file, and never
   * while it is used as an avatar or logo [SEC-26]. Files from before
   * SEC-26 have no uploader: only ADMIN/SYSTEM can delete those.
   */
  async remove(c: ITenantUserApp, id: string) {
    const file = await super.getById(c, id, {
      uploadedBy: SStorage.uploadedBy,
    });

    const privileged =
      c.session.isSuperUser || c.session.role === EUserRole.ADMIN;
    if (!privileged && file.uploadedBy !== c.session.userId) {
      throw status(403, {
        error: "Forbidden",
        message: "Only the uploader or an admin can delete this file",
      });
    }

    if (await this.isReferenced(c, id)) {
      throw status(409, { error: "Conflict", message: "File is in use" });
    }

    // Soft delete only; the object is removed by the purge job [BUG-03].
    return await super.remove(c, id);
  }

  /**
   * Whether an active user (avatar) or tenant (logo) points at the file.
   * System scope: references from any tenant count.
   */
  private async isReferenced(c: IApp, id: string): Promise<boolean> {
    return await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [avatar] = await tx
        .select({ id: SUser.id })
        .from(SUser)
        .where(and(eq(SUser.avatarId, id), eq(SUser.isDeleted, false)))
        .limit(1);
      if (avatar) {
        return true;
      }
      const [logo] = await tx
        .select({ id: STenant.id })
        .from(STenant)
        .where(and(eq(STenant.logoId, id), eq(STenant.isDeleted, false)))
        .limit(1);
      return logo !== undefined;
    });
  }

  async presignUpload(
    c: ITenantUserApp,
    data: { name: string; mimeType: string; size: number },
  ) {
    // Fail before creating any row when presigning is unsupported [BUG-04].
    if (!StorageManager.supportsPresign()) {
      throw status(501, {
        error: "Not Implemented",
        message: "The active storage provider does not support presigned URLs",
      });
    }
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

    const key = `${c.tenantId}/${crypto.randomUUID()}.${storageExtensionFor(data.mimeType)}`;

    // The row stays PENDING (never served) until the upload is finalized.
    const res = await super.create(c, {
      name: data.name,
      key: key,
      mimeType: data.mimeType,
      size: data.size,
      status: EStorageStatus.PENDING,
      uploadedBy: c.session.userId,
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
