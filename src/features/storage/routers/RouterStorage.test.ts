import { describe, it, expect, spyOn, mock } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { eq } from "drizzle-orm";
import { test_db, testHeaders } from "@/common/tests/TestManager.test";
import { SStorage } from "../schemas/SStorage";
import { EStorageStatus } from "../enums/EStorageStatus";
import { createRouterStorage } from "./RouterStorage";
import { test_env as routerTestEnv } from "@/common/tests/TestManager.test";

// Routers are built from an explicit environment [QLT-01].
const RouterStorage = createRouterStorage(routerTestEnv);

const StorageManager = await import("@/infrastructure/storage/StorageManager");

spyOn(StorageManager.default, "upload").mockImplementation(
  mock(() => Promise.resolve()),
);

spyOn(StorageManager.default, "delete").mockImplementation(
  mock(() => Promise.resolve()),
);

spyOn(StorageManager.default, "download").mockImplementation(
  // Providers stream objects [BUG-18].
  mock(() => {
    const blob = new Blob(["mock file data"]);
    return Promise.resolve({ stream: blob.stream(), contentLength: blob.size });
  }),
);

const bytes = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120,
  156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

const api = treaty(RouterStorage);

describe("RouterStorage", () => {
  it("Upload file", async () => {
    const headers = await testHeaders();

    const dummyFile = new File([bytes], "test-image.png", {
      type: "image/png",
    });

    const res = await api.storage.upload.post({ file: dummyFile }, { headers });

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("id");
    expect(res.data).toHaveProperty("key");
  });

  // [TST-04] One test per rule (the old test only checked the type).
  it("[TST-04] rejects a file type outside the allowlist → 422", async () => {
    const headers = await testHeaders();

    const dummyFile = new File(["fake content"], "malicious.exe", {
      type: "application/x-msdownload",
    });

    const res = await api.storage.upload.post({ file: dummyFile }, { headers });

    expect(res.status).toBe(422);
  });

  it("[TST-04] rejects a file larger than STORAGE_MAX_BYTES → 422 and stores nothing", async () => {
    const headers = await testHeaders();
    const tooBig = new Uint8Array(routerTestEnv.STORAGE_MAX_BYTES + 1);
    tooBig.set(bytes);

    const dummyFile = new File([tooBig], "too-big.png", { type: "image/png" });

    const res = await api.storage.upload.post({ file: dummyFile }, { headers });

    expect(res.status).toBe(422);
    expect(
      await test_db
        .select({ id: SStorage.id })
        .from(SStorage)
        .where(eq(SStorage.name, "too-big.png")),
    ).toEqual([]);
  });

  it("List Files", async () => {
    const headers = await testHeaders();
    const dummyFile = new File([bytes], "list-image.png", {
      type: "image/png",
    });

    await api.storage.upload.post({ file: dummyFile }, { headers });

    const res = await api.storage.get({
      headers,
      query: { page: 1, limit: 10 },
    });

    expect(res.status).toBe(200);
    expect(res.data!.data.length).toBeGreaterThanOrEqual(1);

    expect(res.data!.data[0].name).toBe("list-image.png");
  });

  it("View file", async () => {
    const headers = await testHeaders();
    const dummyFile = new File([bytes], "view.png", {
      type: "image/png",
    });

    const uploadRes = await api.storage.upload.post(
      { file: dummyFile },
      { headers },
    );
    const fileId = uploadRes.data!.id;

    const viewRes = await api.storage({ id: fileId }).view.get({ headers });

    expect(viewRes.status).toBe(200);

    expect(viewRes.data).not.toBeNull();
  });

  it("Deletes file", async () => {
    const headers = await testHeaders();
    const dummyFile = new File([bytes], "delete-me.png", {
      type: "image/png",
    });

    const uploadRes = await api.storage.upload.post(
      { file: dummyFile },
      { headers },
    );
    const fileId = uploadRes.data!.id;

    const delRes = await api.storage({ id: fileId }).delete({}, { headers });
    expect(delRes.status).toBe(200);

    const checkRes = await api.storage({ id: fileId }).view.get({ headers });
    expect(checkRes.status).toBe(404);
  });

  it("Generates pre-signed upload URL and pre-signed download URL", async () => {
    const headers = await testHeaders();

    // 1. Presign upload URL
    const presignUploadRes = await api.storage["presign-upload"].post(
      {
        name: "document.pdf",
        mimeType: "application/pdf",
        size: 1024 * 100,
      },
      { headers },
    );

    expect(presignUploadRes.status).toBe(200);
    expect(presignUploadRes.data?.uploadUrl).toBeDefined();
    expect(typeof presignUploadRes.data?.uploadUrl).toBe("string");
    expect(presignUploadRes.data?.key).toBeDefined();
    expect(presignUploadRes.data?.id).toBeDefined();

    const fileId = presignUploadRes.data!.id;

    // [SEC-10] A presigned upload starts PENDING and is never served until
    // it is finalized; simulate the finalization (FEAT-12) here.
    await test_db
      .update(SStorage)
      .set({ status: EStorageStatus.READY })
      .where(eq(SStorage.id, fileId));

    // 2. Presign download URL
    const fileApi = api.storage({ id: fileId });
    const presignDownloadRes = await fileApi["presign-download"].get({
      headers,
    });

    expect(presignDownloadRes.status).toBe(200);
    expect(presignDownloadRes.data?.downloadUrl).toBeDefined();
    expect(typeof presignDownloadRes.data?.downloadUrl).toBe("string");
  });
});
