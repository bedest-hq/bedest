import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import EnvManager from "@/infrastructure/env/EnvManager";
import RateLimitManager from "@/infrastructure/ratelimit/RateLimitManager";
import ServiceTenant from "../services/ServiceTenant";
import { VTenantDomain } from "../validations/VTenantDomain";
import { VId, VString } from "bedest-core";

const MINUTE_MS = 60 * 1000;

export const RouterTenantPublic = new Elysia({
  prefix: "/public",
  tags: ["Tenant"],
})
  .use(Context.App())
  // Unauthenticated lookup: throttled so tenants cannot be enumerated
  // [SEC-25].
  .use(
    RateLimitManager.limiter({
      name: "tenant:resolve",
      max: () => EnvManager.get().RATE_LIMIT_TENANT_RESOLVE_PER_MIN,
      durationMs: MINUTE_MS,
      key: ({ clientIp }) => clientIp,
    }),
  )
  .get(
    "/resolve",
    async ({ headers, db, nowDatetime }) => {
      const domain = headers["x-tenant-domain"];

      return await ServiceTenant.checkDomain({ db, nowDatetime }, domain);
    },
    {
      headers: t.Object({
        "x-tenant-domain": VTenantDomain,
      }),
      response: t.Object({
        id: VId,
        name: VString,
        logoId: t.Nullable(VId),
      }),
    },
  );
