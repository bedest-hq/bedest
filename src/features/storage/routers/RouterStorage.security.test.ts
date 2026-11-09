import { describe, it, expect, spyOn, mock } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import {
  test_db,
  test_env,
  test_tenant,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { SStorage } from "../schemas/SStorage";
import { EStorageStatus } from "../enums/EStorageStatus";
import { RouterStorage } from "./RouterStorage";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

// External I/O only: the object store.
spyOn(StorageManager.default, "download").mockImplementation(
  // Providers stream objects [BUG-18].
  mock(() => {
    const blob = new Blob(["<script>alert(1)</script>"]);
    return Promise.resolve({ stream: blob.stream(), contentLength: blob.size });
  }),
);

const api = treaty(RouterStorage);
const app = new Elysia().use(ErrorHandler).use(RouterStorage);

const insertFile = async (mimeType: string, status: EStorageStatus) => {
  const [row] = await test_db
    .insert(SStorage)
    .values({
      tenantId: test_tenant.id,
      name: "file.bin",
      key: `${test_tenant.id}/${crypto.randomUUID()}`,
      mimeType,
      size: 10,
      status,
    })
    .returning({ id: SStorage.id });
  return row.id;
};

const get = async (path: string) =>
  app.handle(
    new Request(`http://localhost${path}`, { headers: await testHeaders() }),
  );

const expectHardenedFileHeaders = (res: Response) => {
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("content-security-policy")).toBe(
    "default-src 'none'; sandbox",
  );
  expect(res.headers.get("cross-origin-resource-policy")).toBe("same-site");
};

describe("SEC-10: no stored XSS through uploads", () => {
  it("[SEC-10] presign with text/html → 400", async () => {
    const res = await api.storage["presign-upload"].post(
      { name: "evil.html", mimeType: "text/html", size: 100 },
      { headers: await testHeaders() },
    );
    expect(res.status).toBe(400);
  });

  it("[SEC-10] presign with size > STORAGE_MAX_BYTES → 400", async () => {
    const res = await api.storage["presign-upload"].post(
      {
        name: "huge.png",
        mimeType: "image/png",
        size: test_env.STORAGE_MAX_BYTES + 1,
      },
      { headers: await testHeaders() },
    );
    expect(res.status).toBe(400);
  });

  it("[SEC-10] the presigned PUT signs Content-Type and Content-Length and the row starts PENDING", async () => {
    const res = await api.storage["presign-upload"].post(
      { name: "doc.pdf", mimeType: "application/pdf", size: 1234 },
      { headers: await testHeaders() },
    );
    expect(res.status).toBe(200);
    const url = new URL(res.data?.uploadUrl ?? "http://invalid");
    const signed = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(
      ";",
    );
    expect(signed).toContain("content-type");
    expect(signed).toContain("content-length");

    const id = res.data?.id ?? "";
    expect((await get(`/storage/${id}/view`)).status).toBe(404);
  });

  it("[SEC-10] /view of a READY file whose type is not inline-safe is forced to attachment", async () => {
    const id = await insertFile("text/html", EStorageStatus.READY);
    const res = await get(`/storage/${id}/view`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toStartWith("attachment;");
    expectHardenedFileHeaders(res);
  });

  it("[SEC-10] /view of an image is inline and still hardened", async () => {
    const id = await insertFile("image/png", EStorageStatus.READY);
    const res = await get(`/storage/${id}/view`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toStartWith("inline;");
    expectHardenedFileHeaders(res);
  });

  it("[SEC-10] /download always carries the hardened headers", async () => {
    const id = await insertFile("application/pdf", EStorageStatus.READY);
    const res = await get(`/storage/${id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toStartWith("attachment;");
    expectHardenedFileHeaders(res);
  });

  it("[SEC-10] PENDING rows are 404 on view/download/presign-download and absent from lists", async () => {
    const pending = await insertFile("image/png", EStorageStatus.PENDING);
    const ready = await insertFile("image/png", EStorageStatus.READY);

    for (const path of ["view", "download", "presign-download"]) {
      expect((await get(`/storage/${pending}/${path}`)).status).toBe(404);
    }

    const list = await api.storage.get({
      headers: await testHeaders(),
      query: { limit: 100, page: 1 },
    });
    const ids = (list.data?.data ?? []).map((f) => f.id);
    expect(ids).toContain(ready);
    expect(ids).not.toContain(pending);
  });
});
