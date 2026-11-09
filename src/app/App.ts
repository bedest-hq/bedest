import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import { TDb } from "bedest-core";
import { TEnv } from "@/common/types/TEnv";
import { UtilEnv } from "@/infrastructure/env/UtilEnv";
import DbManager from "@/infrastructure/database/DbManager";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { PluginSecurityHeaders } from "./plugins/PluginSecurityHeaders";
import { PluginBodyLimit } from "./plugins/PluginBodyLimit";
import { PluginCsrf } from "./plugins/PluginCsrf";
import { createRouter } from "./Router";

export interface IAppDeps {
  /** Database handle to use instead of the one DbManager.init(env) opened. */
  db?: TDb;
}

/**
 * Builds the whole HTTP application for `env` without listening [QLT-01].
 * Startup order lives in src/index.ts (env → infrastructure → createApp →
 * listen → shutdown hooks); tests call createApp with test dependencies.
 * Importing this module (or any router) never reads the environment.
 */
export const createApp = (env: TEnv, deps: IAppDeps = {}) => {
  if (deps.db) {
    DbManager.use(deps.db);
  }

  return (
    new Elysia()
      .use(
        cors({
          origin:
            env.NODE_ENV === "production" ? UtilEnv.corsOrigins(env) : true,
          credentials: true,
        }),
      )
      // HTTP hardening [SEC-18]: headers, body limit and CSRF run first.
      .use(PluginSecurityHeaders)
      .use(PluginBodyLimit)
      .use(PluginCsrf)
      .use(ErrorHandler)
      .get("/favicon.ico", () => Bun.file("public/favicon.ico"))
      .use(createRouter(env))
  );
};

/** The API type for Eden Treaty clients (client/) [QLT-01][QLT-06]. */
export type App = ReturnType<typeof createApp>;
