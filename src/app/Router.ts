import Elysia from "elysia";
import { RouterUser } from "../features/user/routers/RouterUser";
import { Swagger } from "./Swagger";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { RouterAuth } from "@f/auth/routers/RouterAuth";
import { RouterSystem } from "@f/system/routers/RouterSystem";
import { RouterStorage } from "@f/storage/routers/RouterStorage";
import { RouterNotification } from "@f/notification/routers/RouterNotification";
import { RouterBilling } from "@f/billing/routers/RouterBilling";
import { RouterHealth } from "@f/health/routers/RouterHealth";
import { TEnv } from "@/common/types/TEnv";
import EnvManager from "@/infrastructure/env/EnvManager";
import { logger } from "@/infrastructure/logger/logger";

export const createRouter = (env: Pick<TEnv, "BILLING_WEBHOOK_SECRET">) => {
  const v1 = new Elysia({ prefix: "/v1" })
    .use(RouterAuth)
    .use(RouterUser)
    .use(RouterTenant)
    .use(RouterStorage)
    .use(RouterSystem)
    .use(RouterNotification);

  // Health lives outside /api/v1 (FEAT-01).
  const api = new Elysia({ prefix: "/api" })
    .use(Swagger)
    .use(RouterHealth)
    .use(v1);

  // The webhook is only reachable when a signing secret is configured; it is
  // not part of the client-facing API type.
  if (env.BILLING_WEBHOOK_SECRET) {
    api.use(new Elysia({ prefix: "/v1" }).use(RouterBilling));
  } else {
    logger.info("Billing webhook disabled (BILLING_WEBHOOK_SECRET is not set).");
  }

  return api;
};

export const Router = createRouter(EnvManager.get());
