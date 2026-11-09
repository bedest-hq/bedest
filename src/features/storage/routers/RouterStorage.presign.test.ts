import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import {
  test_db,
  test_tenant,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { ProviderLocal } from "@/infrastructure/storage/providers/ProviderLocal";
import { SStorage } from "../schemas/SStorage";
import { EStorageStatus } from "../enums/EStorageStatus";
import { RouterStorage } from "./RouterStorage";

const StorageManager = await import("@/infrastructure/storage/StorageManager");

const app = new Elysia().use(ErrorHandler).use(RouterStorage);

describe("BUG-04: presigning without provider support", () => {
  it("[BUG-04] presign-upload on the local provider → 501 and no row is created", async () => {
    const restore = StorageManager.default.useProviderForTesting(
      new ProviderLocal("./test_uploads"),
    );
    try {
      const res = await app.handle(
        new Request("http://localhost/storage/presign-upload", {
          method: "POST",
          headers: {
            ...(await testHeaders()),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "a.png",
            mimeType: "image/png",
            size: 10,
          }),
        }),
      );
      expect(res.status).toBe(501);
      expect(await test_db.select().from(SStorage)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("[BUG-04] presign-download on the local provider → 501", async () => {
    const [row] = await test_db
      .insert(SStorage)
      .values({
        tenantId: test_tenant.id,
        name: "a.png",
        key: `${test_tenant.id}/${crypto.randomUUID()}.png`,
        mimeType: "image/png",
        size: 10,
        status: EStorageStatus.READY,
      })
      .returning({ id: SStorage.id });
    const restore = StorageManager.default.useProviderForTesting(
      new ProviderLocal("./test_uploads"),
    );
    try {
      const res = await app.handle(
        new Request(`http://localhost/storage/${row.id}/presign-download`, {
          headers: await testHeaders(),
        }),
      );
      expect(res.status).toBe(501);
    } finally {
      restore();
    }
  });
});
