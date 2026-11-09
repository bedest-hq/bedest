import { describe, it, expect, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { test_db, testHeaders } from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { SStorage } from "../schemas/SStorage";
import { createRouterStorage } from "./RouterStorage";
import { test_env as routerTestEnv } from "@/common/tests/TestManager.test";

// Routers are built from an explicit environment [QLT-01].
const RouterStorage = createRouterStorage(routerTestEnv);

const StorageManager = await import("@/infrastructure/storage/StorageManager");

const app = new Elysia().use(ErrorHandler).use(RouterStorage);

const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120,
  156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

const upload = async (name: string, type = "image/png") => {
  const form = new FormData();
  form.append("file", new File([png], name, { type }));
  return app.handle(
    new Request("http://localhost/storage/upload", {
      method: "POST",
      headers: await testHeaders(),
      body: form,
    }),
  );
};

describe("BUG-03: storage write/delete ordering", () => {
  it("[BUG-03] a failing object upload leaves no database row", async () => {
    // External I/O only: the object store rejects the write.
    const put = spyOn(StorageManager.default, "upload").mockImplementation(() =>
      Promise.reject(new Error("bucket unavailable")),
    );
    try {
      const res = await upload("photo.png");
      expect(res.status).toBe(500);
      expect(await test_db.select().from(SStorage)).toHaveLength(0);
    } finally {
      put.mockImplementation(() => Promise.resolve());
    }
  });

  it("[BUG-03] when the database write fails no object is uploaded (no orphan)", async () => {
    const put = spyOn(StorageManager.default, "upload").mockImplementation(() =>
      Promise.resolve(),
    );
    put.mockClear();
    // 300-character name: the insert into varchar(255) fails.
    const res = await upload(`${"n".repeat(296)}.png`);
    expect(res.status).not.toBe(200);
    expect(put).not.toHaveBeenCalled();
  });

  it("[BUG-03] the object key extension comes from the MIME type, never the client file name", async () => {
    spyOn(StorageManager.default, "upload").mockImplementation(() =>
      Promise.resolve(),
    );
    const res = await upload("my-photo");
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    expect(key).toEndWith(".png");
  });

  it("[BUG-03] remove only soft-deletes; the object stays until the purge job", async () => {
    spyOn(StorageManager.default, "upload").mockImplementation(() =>
      Promise.resolve(),
    );
    const del = spyOn(StorageManager.default, "delete").mockImplementation(() =>
      Promise.resolve(),
    );
    del.mockClear();
    const { id } = (await (await upload("doc.png")).json()) as { id: string };

    const res = await app.handle(
      new Request(`http://localhost/storage/${id}`, {
        method: "DELETE",
        headers: await testHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    expect(del).not.toHaveBeenCalled();
    const [row] = await test_db
      .select()
      .from(SStorage)
      .where(eq(SStorage.id, id));
    expect(row?.isDeleted).toBe(true);
  });
});
