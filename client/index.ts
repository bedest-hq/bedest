import { treaty } from "@elysiajs/eden";
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
