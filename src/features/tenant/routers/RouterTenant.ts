import { Elysia, t } from "elysia";
import { VId } from "../../../common/validations/VId";
import { VString } from "../../../common/validations/VString";
import { STenant } from "../schemas/STenant";
import { ETenantPlan } from "../enums/ETenantPlan";
import ServiceTenant from "../services/ServiceTenant";
import Context from "@/app/Context";
import { UtilRouter } from "@/common/utils/UtilRouter";
import { VEmail } from "@/common/validations/VEmail";
import { EUserRole } from "@f/user/enums/EUserRole";
import { VQuery } from "@/common/validations/VQuery";

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
        name: STenant.name,
        email: STenant.email,
      });

      return UtilRouter.defResponse(res);
    },
    {
      params: t.Object({
        id: VId,
      }),
      response: UtilRouter.defSchema(
        t.Object({
          name: VString,
          email: VEmail,
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
        id: VId,
      }),
      body: t.Object({
        name: t.Optional(VString),
        country: t.Optional(VString),
        phone: t.Optional(VString),
        email: t.Optional(VString),
        plan: t.Optional(
          t.Union([
            t.Literal(ETenantPlan.BASIC),
            t.Literal(ETenantPlan.STANDARD),
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
              name: VString,
              country: VString,
              phone: VString,
              email: VString,
              plan: t.Union([
                t.Literal(ETenantPlan.BASIC),
                t.Literal(ETenantPlan.STANDARD),
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
              id: VId,
            }),
          },
        )
        .get(
          "/",
          async ({ query, userRuntime }) => {
            const res = await ServiceTenant.getAll(userRuntime, query, {
              name: STenant.name,
              country: STenant.country,
              email: STenant.email,
            });

            return UtilRouter.defResponse(res);
          },
          {
            query: VQuery,
            response: UtilRouter.defSchema(
              t.Array(
                t.Object({
                  name: VString,
                  country: VString,
                  email: VEmail,
                }),
              ),
            ),
          },
        ),
  );
