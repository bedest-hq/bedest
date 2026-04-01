import { Elysia } from "elysia";
import EnvManager from "./infrastructure/env/EnvManager";
import DbManager from "./infrastructure/database/DbManager";
import { ErrorHandler } from "./infrastructure/error/ErrorHandler";
import cors from "@elysiajs/cors";
import { logger } from "./infrastructure/logger/logger";

const env = EnvManager.init();

DbManager.init(env);

const { Router } = await import("./app/Router");

export const app = new Elysia()
  .use(
    cors({
      origin: env.NODE_ENV === "production" ? env.CORS_ORIGIN : true,
      credentials: true,
    }),
  )
  .use(ErrorHandler)
  .get("/favicon.ico", () => Bun.file("public/favicon.ico"))
  .use(Router)
  .listen(env.PORT);

logger.info("✨ Hello Bedest ✨");
logger.info(
  `⚡ Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
);
logger.info(
  `📖 For API Documentation http://${app.server?.hostname}:${app.server?.port}/api/docs`,
);
