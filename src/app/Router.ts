import Elysia from "elysia";
import { RouterExample } from "../features/example/routers/RouterExample";
import { RouterLogin } from "../features/auth/routers/RouterLogin";
import { RouterLogout } from "../features/auth/routers/RouterLogout";
import { RouterUser } from "../features/user/routers/RouterUser";
import { Swagger } from "./Swagger";

const v1 = new Elysia({ prefix: "/v1" })
  .use(RouterLogin)
  .use(RouterLogout)
  .use(RouterExample)
  .use(RouterUser);

export const Router = new Elysia({ prefix: "/api" }).use(Swagger).use(v1);
