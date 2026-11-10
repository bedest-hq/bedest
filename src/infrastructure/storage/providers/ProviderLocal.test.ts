import { describe, it, expect } from "bun:test";
import { stat } from "node:fs/promises";
import { ProviderLocal } from "./ProviderLocal";

/** A fresh directory under test_uploads/ (removed after the run, TST-06). */
const freshDir = () => `./test_uploads/provider-local-${crypto.randomUUID()}`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("ProviderLocal", () => {
  it("[BUG-18] healthCheck creates the storage directory", async () => {
    const dir = freshDir();
    await new ProviderLocal(dir).healthCheck();
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  it("[BUG-18] upload, head, streamed download and delete of one object", async () => {
    const provider = new ProviderLocal(freshDir());
    await provider.upload("tenant/a.png", PNG.buffer);

    expect(await provider.head("tenant/a.png")).toEqual({
      contentLength: PNG.byteLength,
      contentType: "image/png",
    });
    const object = await provider.download("tenant/a.png");
    expect(object?.contentLength).toBe(PNG.byteLength);
    expect(
      new Uint8Array(await new Response(object?.stream).arrayBuffer()),
    ).toEqual(PNG);

    await provider.delete("tenant/a.png");
    expect(await provider.head("tenant/a.png")).toBeNull();
    expect(await provider.download("tenant/a.png")).toBeNull();
    // Deleting a missing object is a no-op.
    await provider.delete("tenant/a.png");
  });

  it("[BUG-03] a failed write throws (the caller removes its PENDING row)", async () => {
    const provider = new ProviderLocal(freshDir());
    await provider.upload("blocker", PNG.buffer);
    // "blocker" is a file, so it cannot be a directory of another key.
    const err = await provider.upload("blocker/child.png", PNG.buffer).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(err)).toContain("Local storage upload failed");
  });
});
