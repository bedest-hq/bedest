import { Elysia } from "elysia";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilOrigin } from "./UtilOrigin";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_COOKIE_RE = /(?:^|;\s*)(?:accessToken|refreshToken)=/;

/** Endpoints that never rely on the auth cookie (machine callers). */
const isExempt = (path: string) =>
  path.startsWith("/api/health/") || path === "/api/v1/billing/webhook";

/**
 * CSRF protection ([DECISION] default) [SEC-18]: in production, a
 * state-changing request that carries the auth cookie must come from an
 * allowed origin (Origin header, or Referer when Origin is absent).
 */
export const PluginCsrf = new Elysia({ name: "PluginCsrf" }).onRequest(
  // onRequest always runs for every request of the app, before routing.
  ({ request, set }) => {
    const env = EnvManager.get();
    if (env.NODE_ENV !== "production" || !UNSAFE_METHODS.has(request.method)) {
      return;
    }
    if (!AUTH_COOKIE_RE.test(request.headers.get("cookie") ?? "")) {
      return;
    }
    if (isExempt(new URL(request.url).pathname)) {
      return;
    }
    if (!UtilOrigin.isAllowed(UtilOrigin.requestOrigin(request), env)) {
      set.status = 403;
      return { error: "Forbidden", message: "Cross-site request rejected" };
    }
  },
);
