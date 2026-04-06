import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import { VId, VString } from "@/common/validations/VCommon";
import ServiceTenant from "../services/ServiceTenant";

export const RouterTenantPublic = new Elysia({
  prefix: "/public",
  tags: ["Tenant"],
})
  .use(Context.App())
  .get(
    "/resolve",
    async ({ headers, db, nowDatetime }) => {
      const domain = headers["x-tenant-domain"];

      return await ServiceTenant.checkDomain({ db, nowDatetime }, domain);
    },
    {
      headers: t.Object({
        "x-tenant-domain": VString,
      }),
      response: t.Object({
        id: VId,
        name: VString,
        logoId: t.Nullable(VId),
      }),
    },
  );
