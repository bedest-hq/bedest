import { Elysia } from "elysia";
import EnvManager from "./infrastructure/env/EnvManager";
import DbManager from "./infrastructure/db/DbManager";

const env = EnvManager.init();

await DbManager.init(env);

const { Router } = await import("./app/Router");

export const app = new Elysia()
  .use(Router)
  .get("", () => "Hello Elysia")
  .listen(3000);

// eslint-disable-next-line no-console
console.log(`Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
