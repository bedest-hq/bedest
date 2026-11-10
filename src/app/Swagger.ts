import { openapi } from "@elysiajs/openapi";
import { TEnv } from "@/common/types/TEnv";
import pkg from "../../package.json";

/**
 * OpenAPI documentation (UI at /api/docs, spec at /api/docs/json) [SEC-17].
 * Exposed outside production, or in production only when
 * ENABLE_API_DOCS=true.
 */
export const shouldServeDocs = (
  env: Pick<TEnv, "NODE_ENV" | "ENABLE_API_DOCS">,
) => env.NODE_ENV !== "production" || env.ENABLE_API_DOCS === true;

export const createDocs = () =>
  openapi({
    path: "/docs",
    documentation: {
      info: {
        title: pkg.name,
        version: pkg.version,
      },
      components: {
        securitySchemes: {
          // Authentication is an HttpOnly cookie set by /api/v1/auth/login.
          accessToken: {
            type: "apiKey",
            in: "cookie",
            name: "accessToken",
          },
        },
      },
      security: [{ accessToken: [] }],
    },
  });
