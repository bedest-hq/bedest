import { Elysia, t } from "elysia";
import { SId } from "../../../common/schemas/SId";
import { SString } from "../../../common/schemas/SString";
import { TbTenant } from "../tables/TbTenant";
import { ETenantPlan } from "../enums/ETenantPlan";
import ServiceTenant from "../services/ServiceTenant";
import Context from "@/app/Context";
import { UtilRouter } from "@/common/utils/UtilRouter";
import { SEmail } from "@/common/schemas/SEmail";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SQuery } from "@/common/schemas/SQuery";

export const RouterTenant = new Elysia({
  prefix: "/tenant",
  tags: ["Tenant"],
})
  .use(Context.User())
  .get(
    "/:id",
    async ({ params, userRuntime }) => {
      const id = params.id;

      const res = await ServiceTenant.getById(userRuntime, id, {
        name: TbTenant.name,
        email: TbTenant.email,
      });

      return UtilRouter.defResponse(res);
    },
    {
      params: t.Object({
        id: SId,
      }),
      response: UtilRouter.defSchema(
        t.Object({
          name: SString,
          email: SEmail,
        }),
      ),
    },
  )
  .put(
    "/:id",
    async ({ body, params, userRuntime }) => {
      const id = params.id;
      return await ServiceTenant.update(userRuntime, id, body);
    },
    {
      RoleGuard: [EUserRole.ADMIN, EUserRole.SYSTEM],
      params: t.Object({
        id: SId,
      }),
      body: t.Object({
        name: t.Optional(SString),
        country: t.Optional(SString),
        phone: t.Optional(SString),
        email: t.Optional(SString),
        plan: t.Optional(
          t.Union([
            t.Literal(ETenantPlan.BASIC),
            t.Literal(ETenantPlan.STANDART),
            t.Literal(ETenantPlan.PROFESSIONAL),
          ]),
        ),
        planStart: t.Optional(t.Date()),
        planEnd: t.Optional(t.Date()),
      }),
    },
  )
  .guard(
    {
      RoleGuard: [EUserRole.SYSTEM],
    },
    (app) =>
      app
        .post(
          "/",
          async ({ body, userRuntime }) => {
            return await ServiceTenant.create(userRuntime, body);
          },
          {
            body: t.Object({
              name: SString,
              country: SString,
              phone: SString,
              email: SString,
              plan: t.Union([
                t.Literal(ETenantPlan.BASIC),
                t.Literal(ETenantPlan.STANDART),
                t.Literal(ETenantPlan.PROFESSIONAL),
              ]),
              planStart: t.Date(),
              planEnd: t.Date(),
            }),
          },
        )
        .delete(
          "/:id",
          async ({ params, userRuntime }) => {
            return await ServiceTenant.remove(userRuntime, params.id);
          },
          {
            params: t.Object({
              id: SId,
            }),
          },
        )
        .get(
          "/",
          async ({ query, userRuntime }) => {
            const res = await ServiceTenant.getAll(userRuntime, query, {
              name: TbTenant.name,
              country: TbTenant.country,
              email: TbTenant.email,
            });

            return UtilRouter.defResponse(res);
          },
          {
            query: SQuery,
            response: UtilRouter.defSchema(
              t.Array(
                t.Object({
                  name: SString,
                  country: SString,
                  email: SEmail,
                }),
              ),
            ),
          },
        ),
  );
