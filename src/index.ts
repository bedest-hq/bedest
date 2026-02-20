import { Elysia } from "elysia";
import EnvManager from "./infrastructure/env/EnvManager";
import DbManager from "./infrastructure/db/DbManager";

const env = EnvManager.init();

await DbManager.init(env);

const { Router } = await import("./app/Router");

export const app = new Elysia()
  .get("/favicon.ico", () => Bun.file("public/favicon.ico"))
  .use(Router)
  .get("", () => "Hello Elysia")
  .listen(env.PORT);

// eslint-disable-next-line no-console
console.log(`Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
