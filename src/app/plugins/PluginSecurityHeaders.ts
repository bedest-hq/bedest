import { Elysia } from "elysia";
import EnvManager from "@/infrastructure/env/EnvManager";

/** Security headers on every response, including errors and 404s [SEC-18]. */
export const PluginSecurityHeaders = new Elysia({
  name: "PluginSecurityHeaders",
}).onRequest(
  // onRequest always runs for every request of the app, before routing.
  ({ set }) => {
  set.headers["X-Content-Type-Options"] = "nosniff";
  set.headers["X-Frame-Options"] = "DENY";
  set.headers["Referrer-Policy"] = "no-referrer";
  set.headers["Cross-Origin-Opener-Policy"] = "same-origin";
  if (EnvManager.get().NODE_ENV === "production") {
    set.headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }
});
