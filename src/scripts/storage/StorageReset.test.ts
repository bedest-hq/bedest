import { describe, it, expect } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test_env } from "@/common/tests/TestManager.test";
import { runStorageReset } from "./StorageReset";

const scratchDir = async () => {
  const base = await mkdtemp(join(tmpdir(), "bedest-ops09-"));
  const storage = join(base, "uploads");
  await mkdir(storage);
  await writeFile(join(storage, "file.bin"), "x");
  return { base, storage };
};

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe("OPS-09: storage reset guard", () => {
  it("[OPS-09] refuses with NODE_ENV=production and deletes nothing", async () => {
    const { storage } = await scratchDir();
    const err = await rejection(
      runStorageReset({
        env: { ...test_env, NODE_ENV: "production", LOCAL_STORAGE_PATH: storage },
        argv: ["--yes"],
        confirm: test_env.DATABASE_NAME,
      }),
    );
    expect(String(err)).toContain("NODE_ENV=production");
    expect(existsSync(join(storage, "file.bin"))).toBe(true);
  });

  it("[OPS-09] refuses without confirmation", async () => {
    const { storage } = await scratchDir();
    const err = await rejection(
      runStorageReset({ env: { ...test_env, LOCAL_STORAGE_PATH: storage }, argv: [] }),
    );
    expect(String(err)).toContain("--yes");
    expect(existsSync(storage)).toBe(true);
  });

  it("[OPS-09] with --yes the storage folder is removed", async () => {
    const { storage } = await scratchDir();
    const res = await runStorageReset({
      env: { ...test_env, LOCAL_STORAGE_PATH: storage },
      argv: ["--yes"],
    });
    expect(res.removed).toBe(storage);
    expect(existsSync(storage)).toBe(false);
  });

  it("[OPS-09] never deletes the working directory or a filesystem root", async () => {
    const { base } = await scratchDir();
    for (const path of [".", base, "/"]) {
      const err = await rejection(
        runStorageReset({
          env: { ...test_env, LOCAL_STORAGE_PATH: path },
          argv: ["--yes"],
          cwd: base,
        }),
      );
      expect(String(err)).toContain("Refusing to delete");
    }
    expect(existsSync(base)).toBe(true);
  });
});
