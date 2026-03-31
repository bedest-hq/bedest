import Elysia from "elysia";
import { RouterExample } from "../features/example/routers/RouterExample";
import { RouterUser } from "../features/user/routers/RouterUser";
import { Swagger } from "./Swagger";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { RouterAuth } from "@f/auth/routers/RouterAuth";
import { RouterSystem } from "@f/system/routers/RouterSystem";

const v1 = new Elysia({ prefix: "/v1" })
  .use(RouterAuth)
  .use(RouterExample)
  .use(RouterUser)
  .use(RouterTenant)
  .use(RouterSystem);

export const Router = new Elysia({ prefix: "/api" }).use(Swagger).use(v1);
