import { Elysia } from "elysia";
import EnvManager from "@/infrastructure/env/EnvManager";

/**
 * Rejects declared bodies above MAX_REQUEST_BODY_BYTES with 413 before they
 * are read [SEC-18]. Bun's serve.maxRequestBodySize (set in index.ts) also
 * enforces the limit for chunked bodies.
 */
export const PluginBodyLimit = new Elysia({
  name: "PluginBodyLimit",
}).onRequest(
  // onRequest always runs for every request of the app, before routing.
  ({ request, set }) => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > EnvManager.get().MAX_REQUEST_BODY_BYTES) {
      set.status = 413;
      return { error: "Payload Too Large" };
    }
  },
);
