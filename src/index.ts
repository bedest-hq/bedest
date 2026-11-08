import { Elysia } from "elysia";
import EnvManager from "./infrastructure/env/EnvManager";
import { UtilEnv } from "./infrastructure/env/UtilEnv";
import DbManager from "./infrastructure/database/DbManager";
import RedisManager from "./infrastructure/redis/RedisManager";
import { ErrorHandler } from "./infrastructure/error/ErrorHandler";
import cors from "@elysiajs/cors";
import { logger } from "./infrastructure/logger/logger";
import WsManager from "./infrastructure/websocket/WsManager";
import { checkForUpdates } from "./infrastructure/update/UpdateChecker";

const env = EnvManager.init();

DbManager.init(env);

// Superuser / BYPASSRLS connections silently disable RLS [SEC-04].
const roleWarning = await DbManager.verifyRuntimeRole(
  DbManager.get(),
  env.NODE_ENV,
);
RedisManager.init(env.REDIS_URL);

const { Router } = await import("./app/Router");

export const app = new Elysia()
  .use(
    cors({
      origin: env.NODE_ENV === "production" ? UtilEnv.corsOrigins(env) : true,
      credentials: true,
    }),
  )
  .use(ErrorHandler)
  .get("/favicon.ico", () => Bun.file("public/favicon.ico"))
  .use(Router)
  .listen(env.PORT);

if (app.server) {
  WsManager.init(app.server);
}

for (const warning of [
  ...EnvManager.getWarnings(),
  ...(roleWarning ? [roleWarning] : []),
]) {
  logger.warn(warning);
}

logger.info("✨ Hello Bedest ✨");
logger.info(
  `⚡ Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
);
logger.info(
  `📖 For API Documentation http://${app.server?.hostname}:${app.server?.port}/api/docs`,
);

void checkForUpdates();

export type App = typeof app;
