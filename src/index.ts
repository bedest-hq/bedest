import EnvManager from "./infrastructure/env/EnvManager";
import DbManager from "./infrastructure/database/DbManager";
import RedisManager from "./infrastructure/redis/RedisManager";
import { logger } from "./infrastructure/logger/logger";
import WsManager from "./infrastructure/websocket/WsManager";
import { checkForUpdates } from "./infrastructure/update/UpdateChecker";
import ServiceSystem from "./features/system/services/ServiceSystem";
import ServiceHealth from "./features/health/services/ServiceHealth";
import { createShutdown } from "./app/Shutdown";
import { createApp } from "./app/App";
import { JobScheduler } from "./infrastructure/jobs/JobScheduler";
import { createJobs } from "./infrastructure/jobs/jobs";

// Startup order [QLT-01]: environment → infrastructure → app → listen →
// shutdown hooks. No module reads the environment when it is imported.
const env = EnvManager.init();

DbManager.init(env);

// Superuser / BYPASSRLS connections silently disable RLS [SEC-04].
const roleWarning = await DbManager.verifyRuntimeRole(
  DbManager.get(),
  env.NODE_ENV,
);
RedisManager.init(env.REDIS_URL);
// Maintenance-mode invalidations from other nodes [BUG-08].
await ServiceSystem.listen();

const app = createApp(env).listen({
  port: env.PORT,
  maxRequestBodySize: env.MAX_REQUEST_BODY_BYTES,
});

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

// Background jobs [FEAT-08]; one node per job at a time (advisory lock).
const jobs = new JobScheduler({
  db: () => DbManager.get(),
  lock: DbManager.jobLock,
  onError: (job, err) => logger.error({ err, job }, "Background job failed"),
});
for (const job of createJobs(env)) {
  jobs.register(job);
}
if (env.JOBS_ENABLED) {
  jobs.start();
}

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
    // Waits for running jobs, at most 10 s [FEAT-03].
    { name: "stopJobs", run: () => jobs.stop() },
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

export type { App } from "./app/App";
