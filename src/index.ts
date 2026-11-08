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
import { createShutdown } from "./app/Shutdown";
import ServiceHealth from "./features/health/services/ServiceHealth";

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

void checkForUpdates(env.NODE_ENV);

// Graceful shutdown [FEAT-03][OPS-08].
const shutdown = createShutdown({
  timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  exit: (code) => process.exit(code),
  log: (level, message, err) =>
    level === "error" ? logger.error({ err }, message) : logger.info(message),
  steps: [
    { name: "markNotReady", run: () => ServiceHealth.markNotReady() },
    { name: "stopServer", run: () => app.stop() },
    { name: "closeWebSockets", run: () => WsManager.closeAll(1001) },
    { name: "closeRedis", run: () => RedisManager.close() },
    { name: "closeDb", run: () => DbManager.shutdown() },
    {
      name: "flushLogger",
      run: () => new Promise<void>((resolve) => logger.flush(() => resolve())),
    },
  ],
});
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export type App = typeof app;
