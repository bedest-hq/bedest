import { tmpdir } from "os";
import { join } from "path";

interface BedestConfig {
  template?: string;
  version?: string;
}

interface UpdateCache {
  timestamp?: number;
  latestVersion?: string;
  releaseUrl?: string;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
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

export async function checkForUpdates(): Promise<void> {
  if (Bun.env.NODE_ENV !== "development") {
    return;
  }

  try {
    const config = (await Bun.file("./bedest.json").json()) as BedestConfig;
    const currentVersion = config.version;
    const template = config.template ?? "bedest";

    if (!currentVersion) {
      return;
    }

    const cachePath = join(tmpdir(), `bedest-update-check-${template}.json`);
    const cacheFile = Bun.file(cachePath);
    let latestVersion: string | null = null;
    let releaseUrl: string | null = null;

    if (await cacheFile.exists()) {
      try {
        const cache = (await cacheFile.json()) as UpdateCache;
        if (
          cache.timestamp &&
          Date.now() - cache.timestamp < ONE_DAY_MS &&
          cache.latestVersion
        ) {
          latestVersion = cache.latestVersion;
          releaseUrl = cache.releaseUrl ?? null;
        }
      } catch {
        // Ignore corrupt cache
      }
    }

    if (!latestVersion) {
      const repo =
        template === "bedest-lite" ? "bedest-hq/bedest-lite" : "bedest-hq/bedest";
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
        const data = (await response.json()) as GitHubRelease;
        if (data.tag_name) {
          latestVersion = data.tag_name;
          releaseUrl =
            data.html_url ??
            `https://github.com/${repo}/releases/tag/${data.tag_name}`;
          await Bun.write(
            cachePath,
            JSON.stringify({ timestamp: Date.now(), latestVersion, releaseUrl }),
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

    // eslint-disable-next-line no-console
    console.log(`\n${renderBanner(name, cleanCurrent, cleanLatest, targetUrl)}\n`);
  } catch {
    // Silent on any error or network failure
  }
}
