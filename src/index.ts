import { Elysia } from "elysia";
import EnvManager from "./infrastructure/env/EnvManager";
import DbManager from "./infrastructure/database/DbManager";
import { GlobalErrorHandler } from "./infrastructure/error/GlobalErrorHandler";
import cors from "@elysiajs/cors";

const env = EnvManager.init();

await DbManager.init(env);

const { Router } = await import("./app/Router");

export const app = new Elysia()
  .use(
    cors({
      origin: Bun.env.NODE_ENV === "production" ? Bun.env.CORS_ORIGIN : "*",
      credentials: true,
    }),
  )
  .use(GlobalErrorHandler)
  .get("/favicon.ico", () => Bun.file("public/favicon.ico"))
  .use(Router)
  .get("", () => "Hello Elysia")
  .listen(env.PORT);

// eslint-disable-next-line no-console
console.log("✨ Hello Bedest ✨");

// eslint-disable-next-line no-console
console.log(
  `⚡ Elysia is running at http://${app.server?.hostname}:${app.server?.port}`,
);

// eslint-disable-next-line no-console
console.log(
  `📖 For API Documentation http://${app.server?.hostname}:${app.server?.port}/api/docs`,
);
