import { describe, it, expect, spyOn } from "bun:test";
import { Elysia } from "elysia";
import {
  test_db,
  test_tenant,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { UtilHttp } from "@/common/utils/UtilHttp";
import { SStorage } from "../schemas/SStorage";
import { EStorageStatus } from "../enums/EStorageStatus";
import { RouterStorage } from "./RouterStorage";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

const app = new Elysia().use(ErrorHandler).use(RouterStorage);

const insertFile = async () => {
  const [row] = await test_db
    .insert(SStorage)
    .values({
      tenantId: test_tenant.id,
      name: "report.pdf",
      key: `${test_tenant.id}/${crypto.randomUUID()}.pdf`,
      mimeType: "application/pdf",
      size: 11,
      status: EStorageStatus.READY,
    })
    .returning({ id: SStorage.id });
  return row.id;
};

const download = async (id: string) =>
  app.handle(
    new Request(`http://localhost/storage/${id}/download`, {
      headers: await testHeaders(),
    }),
  );

describe("BUG-18: downloads are streamed", () => {
  it("[BUG-18] the provider stream is passed through with Content-Length and ETag", async () => {
    const stream = new Blob(["hello world"]).stream();
    const spy = spyOn(StorageManager.default, "download").mockImplementation(
      () => Promise.resolve({ stream, contentLength: 11, etag: '"v1"' }),
    );
    try {
      const res = await download(await insertFile());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-length")).toBe("11");
      expect(res.headers.get("etag")).toBe('"v1"');
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await res.text()).toBe("hello world");
    } finally {
      spy.mockRestore();
    }
  });

  it("[BUG-18] a missing object is 404", async () => {
    const spy = spyOn(StorageManager.default, "download").mockImplementation(
      () => Promise.resolve(null),
    );
    try {
      expect((await download(await insertFile())).status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("[BUG-18] a backend failure is a 5xx, not a 404", async () => {
    const spy = spyOn(StorageManager.default, "download").mockImplementation(
      () => Promise.reject(UtilHttp.fail(502, "Storage backend error")),
    );
    try {
      const res = await download(await insertFile());
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: "Bad Gateway",
        message: "Storage backend error",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
