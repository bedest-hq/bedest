import { describe, it, expect, spyOn, mock } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { createTestUser, test_db, test_tenant } from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SUser } from "@f/user/schemas/SUser";
import { STenant } from "@f/tenant/schemas/STenant";
import { SStorage } from "../schemas/SStorage";
import { EStorageStatus } from "../enums/EStorageStatus";
import { RouterStorage } from "./RouterStorage";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

// External I/O only: the object store.
spyOn(StorageManager.default, "upload").mockImplementation(mock(() => Promise.resolve()));

const app = new Elysia().use(ErrorHandler).use(RouterStorage);

// A complete 1x1 PNG (the upload checks the file signature).
const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120,
  156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

const insertFile = async (uploadedBy: string | null) => {
  const [row] = await test_db
    .insert(SStorage)
    .values({
      tenantId: test_tenant.id,
      name: "file.png",
      key: `${test_tenant.id}/${crypto.randomUUID()}.png`,
      mimeType: "image/png",
      size: 10,
      status: EStorageStatus.READY,
      uploadedBy,
    })
    .returning({ id: SStorage.id });
  return row.id;
};

const remove = (id: string, cookie: string) =>
  app.handle(
    new Request(`http://localhost/storage/${id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    }),
  );

const isDeleted = async (id: string) => {
  const [row] = await test_db
    .select({ isDeleted: SStorage.isDeleted })
    .from(SStorage)
    .where(eq(SStorage.id, id));
  return row.isDeleted;
};

describe("SEC-26: who may delete a file", () => {
  it("[SEC-26] an upload records the uploader", async () => {
    const me = await createTestUser(EUserRole.USER);
    const form = new FormData();
    form.append("file", new File([png], "a.png", { type: "image/png" }));
    const res = await app.handle(
      new Request("http://localhost/storage/upload", {
        method: "POST",
        headers: { Cookie: me.headers.Cookie },
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    const { id }: { id: string } = await res.json();
    const [row] = await test_db
      .select({ uploadedBy: SStorage.uploadedBy })
      .from(SStorage)
      .where(eq(SStorage.id, id));
    expect(row.uploadedBy).toBe(me.user.id);
  });

  it("[SEC-26] the uploader may delete their own file", async () => {
    const owner = await createTestUser(EUserRole.USER);
    const id = await insertFile(owner.user.id);
    expect((await remove(id, owner.headers.Cookie)).status).toBe(200);
    expect(await isDeleted(id)).toBe(true);
  });

  it("[SEC-26] another user of the same tenant gets 403 and the file stays", async () => {
    const owner = await createTestUser(EUserRole.USER);
    const other = await createTestUser(EUserRole.USER);
    const id = await insertFile(owner.user.id);
    expect((await remove(id, other.headers.Cookie)).status).toBe(403);
    expect(await isDeleted(id)).toBe(false);
  });

  it("[SEC-26] an ADMIN may delete any file of the tenant", async () => {
    const owner = await createTestUser(EUserRole.USER);
    const admin = await createTestUser(EUserRole.ADMIN);
    const id = await insertFile(owner.user.id);
    expect((await remove(id, admin.headers.Cookie)).status).toBe(200);
  });

  it("[SEC-26] a legacy file without uploader: only ADMIN/SYSTEM may delete it", async () => {
    const user = await createTestUser(EUserRole.USER);
    const admin = await createTestUser(EUserRole.ADMIN);
    const id = await insertFile(null);
    expect((await remove(id, user.headers.Cookie)).status).toBe(403);
    expect((await remove(id, admin.headers.Cookie)).status).toBe(200);
  });

  it("[SEC-26] a file used as an avatar cannot be deleted (409), even by its uploader or an ADMIN", async () => {
    const owner = await createTestUser(EUserRole.USER);
    const admin = await createTestUser(EUserRole.ADMIN);
    const id = await insertFile(owner.user.id);
    await test_db.update(SUser).set({ avatarId: id }).where(eq(SUser.id, owner.user.id));

    const res = await remove(id, owner.headers.Cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Conflict", message: "File is in use" });
    expect((await remove(id, admin.headers.Cookie)).status).toBe(409);
    expect(await isDeleted(id)).toBe(false);

    // Once unreferenced it can go.
    await test_db.update(SUser).set({ avatarId: null }).where(eq(SUser.id, owner.user.id));
    expect((await remove(id, owner.headers.Cookie)).status).toBe(200);
  });

  it("[SEC-26] a file used as the tenant logo cannot be deleted (409)", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const id = await insertFile(admin.user.id);
    await test_db.update(STenant).set({ logoId: id }).where(eq(STenant.id, test_tenant.id));
    try {
      expect((await remove(id, admin.headers.Cookie)).status).toBe(409);
    } finally {
      await test_db.update(STenant).set({ logoId: null }).where(eq(STenant.id, test_tenant.id));
    }
  });
});
