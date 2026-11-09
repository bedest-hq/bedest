import { TEnv } from "@/common/types/TEnv";
import { tmpdir } from "os";
import { join } from "path";

const DEFAULT_TEMPLATE = "bedest";

const readJson = async (path: string): Promise<Record<string, unknown>> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  const data: unknown = await file.json();
  return typeof data === "object" && data !== null ? { ...data } : {};
};

/**
 * The running template and its version. The version is read from
 * package.json (bumped by release-please); bedest.json only names the
 * template [OPS-10].
 */
export async function readTemplateInfo(
  dir = ".",
): Promise<{ template: string; version: string | null }> {
  const pkg = await readJson(join(dir, "package.json"));
  const config = await readJson(join(dir, "bedest.json"));
  return {
    template:
      typeof config.template === "string" ? config.template : DEFAULT_TEMPLATE,
    version: typeof pkg.version === "string" ? pkg.version : null,
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isNewerVersion(current: string, latest: string): boolean {
  if (current === latest) {
    return false;
  }
  const curr = current.split(".").map((n) => parseInt(n, 10) || 0);
  const lat = latest.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(curr.length, lat.length); i++) {
    const c = curr[i] ?? 0;
    const l = lat[i] ?? 0;
    if (l > c) {
      return true;
    }
    if (l < c) {
      return false;
    }
  }
  return false;
}

function renderBanner(
  name: string,
  current: string,
  latest: string,
  url: string,
): string {
  const lines = [
    `⚡ ${name} update available: ${current} → ${latest}`,
    `See what changed: ${url}`,
    "To sync: merge the upstream PR or run git fetch upstream",
  ];
  const innerWidth = Math.max(...lines.map((ln) => ln.length)) + 4;
  const top = `╭${"─".repeat(innerWidth)}╮`;
  const bottom = `╰${"─".repeat(innerWidth)}╯`;
  const middle = lines.map((ln) => `│  ${ln.padEnd(innerWidth - 2)}│`);
  return [top, ...middle, bottom].join("\n");
}

export async function checkForUpdates(
  nodeEnv: TEnv["NODE_ENV"],
): Promise<void> {
  // Read through VEnv by the caller, never from process env [SEC-16].
  if (nodeEnv !== "development") {
    return;
  }

  try {
    const { template, version: currentVersion } = await readTemplateInfo();

    if (!currentVersion) {
      return;
    }

    const cachePath = join(tmpdir(), `bedest-update-check-${template}.json`);
    const cacheFile = Bun.file(cachePath);
    let latestVersion: string | null = null;
    let releaseUrl: string | null = null;

    if (await cacheFile.exists()) {
      try {
        const cache = await readJson(cachePath);
        if (
          typeof cache.timestamp === "number" &&
          Date.now() - cache.timestamp < ONE_DAY_MS &&
          typeof cache.latestVersion === "string"
        ) {
          latestVersion = cache.latestVersion;
          releaseUrl =
            typeof cache.releaseUrl === "string" ? cache.releaseUrl : null;
        }
      } catch {
        // Ignore corrupt cache
      }
    }

    if (!latestVersion) {
      const repo =
        template === "bedest-lite"
          ? "bedest-hq/bedest-lite"
          : "bedest-hq/bedest";
      const response = await fetch(
        `https://api.github.com/repos/${repo}/releases/latest`,
        {
          headers: {
            "User-Agent": "bedest-update-check",
            Accept: "application/vnd.github.v3+json",
          },
          signal: AbortSignal.timeout(3000),
        },
      );

      if (response.ok) {
        const data: unknown = await response.json();
        const tag =
          typeof data === "object" && data !== null && "tag_name" in data
            ? data.tag_name
            : undefined;
        if (typeof tag === "string" && tag.length > 0) {
          latestVersion = tag;
          const htmlUrl =
            typeof data === "object" && data !== null && "html_url" in data
              ? data.html_url
              : undefined;
          releaseUrl =
            typeof htmlUrl === "string"
              ? htmlUrl
              : `https://github.com/${repo}/releases/tag/${tag}`;
          await Bun.write(
            cachePath,
            JSON.stringify({
              timestamp: Date.now(),
              latestVersion,
              releaseUrl,
            }),
          );
        }
      }
    }

    if (!latestVersion) {
      return;
    }

    const cleanCurrent = currentVersion.replace(/^v/, "").trim();
    const cleanLatest = latestVersion.replace(/^v/, "").trim();

    if (!isNewerVersion(cleanCurrent, cleanLatest)) {
      return;
    }

    const name = template === "bedest-lite" ? "Bedest Lite" : "Bedest";
    const targetUrl =
      releaseUrl ?? `https://github.com/bedest-hq/${template}/releases`;

    process.stdout.write(
      `\n${renderBanner(name, cleanCurrent, cleanLatest, targetUrl)}\n\n`,
    );
  } catch {
    // Silent on any error or network failure
  }
}
