import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTemplateInfo } from "./UpdateChecker";

const project = async (files: Record<string, unknown>) => {
  const dir = await mkdtemp(join(tmpdir(), "bedest-ops10-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(content));
  }
  return dir;
};

describe("OPS-10: version metadata", () => {
  it("[OPS-10] the current version comes from package.json, not bedest.json", async () => {
    const dir = await project({
      "package.json": { name: "my-app", version: "1.2.0" },
      "bedest.json": { template: "bedest", version: "1.1.0" },
    });
    expect(await readTemplateInfo(dir)).toEqual({
      template: "bedest",
      version: "1.2.0",
    });
  });

  it("[OPS-10] bedest.json only names the template", async () => {
    const dir = await project({
      "package.json": { version: "2.0.0" },
      "bedest.json": { template: "bedest" },
    });
    expect(await readTemplateInfo(dir)).toEqual({
      template: "bedest",
      version: "2.0.0",
    });
  });

  it("[OPS-10] no version (or no package.json) disables the check", async () => {
    expect(
      (await readTemplateInfo(await project({ "bedest.json": {} }))).version,
    ).toBeNull();
    expect(
      (
        await readTemplateInfo(
          await project({ "package.json": { version: 3 } }),
        )
      ).version,
    ).toBeNull();
  });

  it("[OPS-10] the repository's own files agree", async () => {
    const info = await readTemplateInfo(".");
    const pkg: { version: string } = await Bun.file("package.json").json();
    expect(info.version).toBe(pkg.version);
    const config: Record<string, unknown> =
      await Bun.file("bedest.json").json();
    expect("version" in config).toBe(false);
  });
});
