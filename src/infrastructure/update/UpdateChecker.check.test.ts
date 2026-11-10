import { describe, it, expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { checkForUpdates, type IUpdateCheckDeps } from "./UpdateChecker";

const NOW = Date.parse("2026-06-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** A project dir with package.json (and optionally bedest.json) [TST-06]. */
const project = async (version: string, template?: string) => {
  const dir = `./test_uploads/update-check-${crypto.randomUUID()}`;
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "package.json"), JSON.stringify({ version }));
  if (template) {
    await Bun.write(join(dir, "bedest.json"), JSON.stringify({ template }));
  }
  return dir;
};

/** Fake GitHub API (external I/O) and a captured banner. */
const harness = (dir: string, release: Response | Error) => {
  const urls: string[] = [];
  const out: string[] = [];
  const deps: IUpdateCheckDeps = {
    dir,
    cachePath: (template) => join(dir, `cache-${template}.json`),
    now: () => NOW,
    write: (text) => {
      out.push(text);
    },
    fetch: (url) => {
      urls.push(url);
      return release instanceof Error
        ? Promise.reject(release)
        : Promise.resolve(release.clone());
    },
  };
  return { deps, urls, out };
};

const release = (tag: string) =>
  Response.json({
    tag_name: tag,
    html_url: `https://github.com/bedest-hq/bedest/releases/tag/${tag}`,
  });

describe("OPS-10: update check", () => {
  it("[OPS-10] only runs in development", async () => {
    const h = harness(await project("1.0.0"), release("v2.0.0"));
    await checkForUpdates("production", h.deps);
    await checkForUpdates("test", h.deps);
    expect(h.urls).toEqual([]);
    expect(h.out).toEqual([]);
  });

  it("[OPS-10] a newer release prints a banner and is cached for a day", async () => {
    const dir = await project("1.0.0");
    const h = harness(dir, release("v2.0.0"));
    await checkForUpdates("development", h.deps);

    expect(h.urls).toEqual([
      "https://api.github.com/repos/bedest-hq/bedest/releases/latest",
    ]);
    expect(h.out.join("")).toContain("Bedest update available: 1.0.0 → 2.0.0");
    expect(h.out.join("")).toContain("/releases/tag/v2.0.0");

    // Within a day the cached answer is used: no second request.
    await checkForUpdates("development", h.deps);
    expect(h.urls).toHaveLength(1);
    expect(h.out).toHaveLength(2);
  });

  it("[OPS-10] a cache older than a day is refreshed; bedest-lite asks its own repository", async () => {
    const dir = await project("1.0.0", "bedest-lite");
    await Bun.write(
      join(dir, "cache-bedest-lite.json"),
      JSON.stringify({ timestamp: NOW - 2 * DAY, latestVersion: "9.9.9" }),
    );
    const h = harness(dir, release("v1.0.0"));
    await checkForUpdates("development", h.deps);
    expect(h.urls).toEqual([
      "https://api.github.com/repos/bedest-hq/bedest-lite/releases/latest",
    ]);
    // Same version: no banner.
    expect(h.out).toEqual([]);
  });

  it("[OPS-10] an older release, a missing tag or a network failure stay silent", async () => {
    for (const answer of [
      release("v0.9.0"),
      Response.json({}),
      new Response("rate limited", { status: 403 }),
      new Error("offline"),
    ]) {
      const h = harness(await project("1.0.0"), answer);
      await checkForUpdates("development", h.deps);
      expect(h.out).toEqual([]);
    }
  });

  it("[OPS-10] version comparison is numeric (1.10.0 is newer than 1.9.0)", async () => {
    const h = harness(await project("1.9.0"), release("1.10.0"));
    await checkForUpdates("development", h.deps);
    expect(h.out.join("")).toContain("1.9.0 → 1.10.0");
  });
});
