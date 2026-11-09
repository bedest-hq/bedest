import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  test_env,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import StorageManager from "@/infrastructure/storage/StorageManager";
import type {
  IObjectHead,
  IProvider,
  IStoredObject,
} from "@/infrastructure/storage/interfaces/IProvider";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SStorage } from "../schemas/SStorage";
import { EStorageStatus } from "../enums/EStorageStatus";
import { createRouterStorage } from "./RouterStorage";

/** In-memory object store standing in for S3 (external I/O). */
class FakeBucket implements IProvider {
  objects = new Map<string, { bytes: Uint8Array; type: string }>();

  healthCheck() {
    return Promise.resolve();
  }

  upload(key: string, body: Buffer | ArrayBuffer, contentType: string) {
    this.objects.set(key, { bytes: new Uint8Array(body), type: contentType });
    return Promise.resolve();
  }

  delete(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }

  download(key: string): Promise<IStoredObject | null> {
    const object = this.objects.get(key);
    if (!object) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      stream: new Blob([new Uint8Array(object.bytes)]).stream(),
      contentLength: object.bytes.byteLength,
      contentType: object.type,
    });
  }

  head(key: string): Promise<IObjectHead | null> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object
        ? { contentLength: object.bytes.byteLength, contentType: object.type }
        : null,
    );
  }

  getUploadUrl(key: string) {
    return Promise.resolve(`https://bucket.example/${key}?signed`);
  }

  getDownloadUrl(key: string) {
    return Promise.resolve(`https://bucket.example/${key}?get`);
  }
}

const app = new Elysia().use(ErrorHandler).use(createRouterStorage(test_env));

const call = (method: string, path: string, cookie: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

let bucket: FakeBucket;
let restore: () => void;

beforeEach(() => {
  bucket = new FakeBucket();
  restore = StorageManager.useProviderForTesting(bucket);
});

afterEach(() => {
  restore();
});

/** Presigns a 4-byte PNG as `cookie`; returns its id and key. */
const presign = async (cookie: string) => {
  const res = await call("POST", "/storage/presign-upload", cookie, {
    name: "photo.png",
    mimeType: "image/png",
    size: 4,
  });
  expect(res.status).toBe(200);
  const body: { id: string; key: string } = await res.json();
  return body;
};

/** What the client's PUT to the presigned URL would store. */
const put = (key: string, bytes: number, type = "image/png") =>
  bucket.upload(key, new ArrayBuffer(bytes), type);

const rowOf = async (id: string) => {
  const [row] = await test_db
    .select({ status: SStorage.status })
    .from(SStorage)
    .where(eq(SStorage.id, id));
  return row;
};

describe("FEAT-12: presigned upload finalization", () => {
  it("[FEAT-12] matching size and type → READY; the file is then listed and served", async () => {
    const { headers } = await createTestUser(EUserRole.USER);
    const { id, key } = await presign(headers.Cookie);
    await put(key, 4);

    const res = await call("POST", `/storage/${id}/complete`, headers.Cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, status: EStorageStatus.READY });
    expect(await rowOf(id)).toEqual({ status: EStorageStatus.READY });

    const list: { data: Array<{ id: string }> } = await (
      await call("GET", "/storage/", headers.Cookie)
    ).json();
    expect(list.data.map((f) => f.id)).toContain(id);
    expect(
      (await call("GET", `/storage/${id}/download`, headers.Cookie)).status,
    ).toBe(200);
  });

  it("[FEAT-12] a size mismatch deletes the object and the row → 400", async () => {
    const { headers } = await createTestUser(EUserRole.USER);
    const { id, key } = await presign(headers.Cookie);
    await put(key, 5);

    const res = await call("POST", `/storage/${id}/complete`, headers.Cookie);
    expect(res.status).toBe(400);
    expect(bucket.objects.has(key)).toBe(false);
    expect(await rowOf(id)).toBeUndefined();
  });

  it("[FEAT-12] a type mismatch deletes the object and the row → 400", async () => {
    const { headers } = await createTestUser(EUserRole.USER);
    const { id, key } = await presign(headers.Cookie);
    await put(key, 4, "text/html");

    const res = await call("POST", `/storage/${id}/complete`, headers.Cookie);
    expect(res.status).toBe(400);
    expect(bucket.objects.has(key)).toBe(false);
    expect(await rowOf(id)).toBeUndefined();
  });

  it("[FEAT-12] content-type parameters and case do not count as a mismatch", async () => {
    const { headers } = await createTestUser(EUserRole.USER);
    const { id, key } = await presign(headers.Cookie);
    await put(key, 4, "Image/PNG; charset=binary");

    const res = await call("POST", `/storage/${id}/complete`, headers.Cookie);
    expect(res.status).toBe(200);
  });

  it("[FEAT-12] no object yet → 400 and the row stays PENDING (the client may still upload)", async () => {
    const { headers } = await createTestUser(EUserRole.USER);
    const { id } = await presign(headers.Cookie);

    const res = await call("POST", `/storage/${id}/complete`, headers.Cookie);
    expect(res.status).toBe(400);
    expect(await rowOf(id)).toEqual({ status: EStorageStatus.PENDING });
  });

  it("[FEAT-12] only the uploader or an ADMIN may complete", async () => {
    const uploader = await createTestUser(EUserRole.USER);
    const colleague = await createTestUser(EUserRole.USER);
    const admin = await createTestUser(EUserRole.ADMIN);
    const { id, key } = await presign(uploader.headers.Cookie);
    await put(key, 4);

    expect(
      (await call("POST", `/storage/${id}/complete`, colleague.headers.Cookie))
        .status,
    ).toBe(403);
    expect(await rowOf(id)).toEqual({ status: EStorageStatus.PENDING });
    expect(
      (await call("POST", `/storage/${id}/complete`, admin.headers.Cookie))
        .status,
    ).toBe(200);
  });

  it("[FEAT-12] another tenant's upload or an unknown id → 404", async () => {
    const owner = await createTestUser(EUserRole.ADMIN);
    const foreign = await createForeignTenant(EUserRole.ADMIN);
    const { id, key } = await presign(owner.headers.Cookie);
    await put(key, 4);

    expect(
      (await call("POST", `/storage/${id}/complete`, foreign.headers.Cookie))
        .status,
    ).toBe(404);
    expect(await rowOf(id)).toEqual({ status: EStorageStatus.PENDING });
    expect(
      (
        await call(
          "POST",
          `/storage/${crypto.randomUUID()}/complete`,
          owner.headers.Cookie,
        )
      ).status,
    ).toBe(404);
  });

  it("[FEAT-12] completing twice is harmless (idempotent 200)", async () => {
    const { headers } = await createTestUser(EUserRole.USER);
    const { id, key } = await presign(headers.Cookie);
    await put(key, 4);

    expect(
      (await call("POST", `/storage/${id}/complete`, headers.Cookie)).status,
    ).toBe(200);
    expect(
      (await call("POST", `/storage/${id}/complete`, headers.Cookie)).status,
    ).toBe(200);
    expect(await rowOf(id)).toEqual({ status: EStorageStatus.READY });
  });
});
