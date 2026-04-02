import { describe, it, expect, spyOn, mock } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { testHeaders } from "@/common/tests/TestManager.test";
import { RouterStorage } from "./RouterStorage";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

spyOn(StorageManager.default, "upload").mockImplementation(
  mock(() => Promise.resolve()),
);

spyOn(StorageManager.default, "delete").mockImplementation(
  mock(() => Promise.resolve()),
);

spyOn(StorageManager.default, "download").mockImplementation(
  mock(() => Promise.resolve(new Blob(["mock file data"]))),
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

  it("Rejects files larger than limit or invalid type", async () => {
    const headers = await testHeaders();

    const dummyFile = new File(["fake content"], "malicious.exe", {
      type: "application/x-msdownload",
    });

    const res = await api.storage.upload.post({ file: dummyFile }, { headers });

    expect(res.status).toBe(422);
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
});
