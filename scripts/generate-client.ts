import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const clientDir = resolve(import.meta.dir, "../client");

if (!existsSync(clientDir)) {
  mkdirSync(clientDir, { recursive: true });
}

// 1. Generate client index.ts
const indexContent = `import { treaty } from "@elysiajs/eden";
import type { App } from "../src/index";

export type { App };

export type TreatyOptions = Parameters<typeof treaty<App>>[1];

/**
 * Creates a strongly typed Eden Treaty client for Bedest API.
 *
 * @param baseUrl Base URL of the Bedest API instance (e.g. "https://api.example.com")
 * @param options Treaty options including custom headers, fetch implementations, etc.
 * @returns Fully typed Elysia client instance
 */
export const createBedestClient = (
  baseUrl: string,
  options?: TreatyOptions,
) => {
  return treaty<App>(baseUrl, options);
};

export type BedestClient = ReturnType<typeof createBedestClient>;

export default createBedestClient;
`;

writeFileSync(resolve(clientDir, "index.ts"), indexContent);

// 2. Generate package.json for standalone consumption
const pkgContent = {
  name: "@bedest/client",
  version: "1.0.0",
  description: "Typed Bedest SDK generated via Elysia Eden Treaty",
  main: "./index.ts",
  types: "./index.ts",
  dependencies: {
    "@elysiajs/eden": "^1.4.9",
  },
  peerDependencies: {
    elysia: ">=1.0.0",
  },
};

writeFileSync(
  resolve(clientDir, "package.json"),
  JSON.stringify(pkgContent, null, 2),
);

// 3. Generate README
const readmeContent = `# @bedest/client

Auto-generated type-safe SDK for Bedest API powered by Elysia Eden Treaty.

## Usage

\`\`\`ts
import { createBedestClient } from "./client";

const client = createBedestClient("http://localhost:3000");

// Fully typed endpoints:
const res = await client.api.v1.tenant.self.get({
  headers: {
    cookie: "accessToken=...",
  },
});
\`\`\`
`;

writeFileSync(resolve(clientDir, "README.md"), readmeContent);

console.log("Client SDK successfully generated at: " + clientDir);
