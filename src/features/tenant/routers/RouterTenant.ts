import { Elysia, t } from "elysia";
import { STenant } from "../schemas/STenant";
import { ETenantPlan } from "../enums/ETenantPlan";
import ServiceTenant from "../services/ServiceTenant";
import Context from "@/app/Context";
import { EUserRole } from "@f/user/enums/EUserRole";
import { VTenantPlan } from "../validations/VTenantPlan";
import { RouterTenantPublic } from "./RouterTenantPublic";
import ServiceUser from "@f/user/services/ServiceUser";
import { UtilRouter, VEmail, VId, VQuery, VString } from "bedest-core";

export const RouterTenant = new Elysia({
  prefix: "/tenant",
  tags: ["Tenant"],
})
  .use(RouterTenantPublic)
  .use(Context.User())
  .get(
    "/self",
    async ({ userRuntime }) => {
      const res = await ServiceTenant.getById(
        userRuntime,
        userRuntime.tenantId,
        {
          id: STenant.id,
          name: STenant.name,
          domain: STenant.domain,
          email: STenant.email,
          country: STenant.country,
          logoId: STenant.logoId,
          plan: STenant.plan,
          planEnd: STenant.planEnd,
          phones: STenant.phones,
          links: STenant.links,
          address: STenant.address,
          city: STenant.city,
          state: STenant.state,
          zipCode: STenant.zipCode,
          taxId: STenant.taxId,
          currency: STenant.currency,
          timezone: STenant.timezone,
          description: STenant.description,
          tagline: STenant.tagline,
          workingHours: STenant.workingHours,
          copyright: STenant.copyright,
        },
      );

      return res;
    },
    {
      response: t.Object({
        id: VId,
        name: VString,
        domain: VString,
        email: VEmail,
        country: VString,
        logoId: t.Nullable(VId),
        plan: VTenantPlan,
        planEnd: t.Date(),
        phones: t.Array(t.String()),
        links: t.Array(t.String()),
        address: t.Nullable(VString),
        city: t.Nullable(VString),
        state: t.Nullable(VString),
        zipCode: t.Nullable(VString),
        taxId: t.Nullable(VString),
        currency: VString,
        timezone: VString,
        description: t.Nullable(VString),
        tagline: t.Nullable(VString),
        workingHours: t.Nullable(VString),
        copyright: t.Nullable(VString),
      }),
    },
  )
  .get(
    "/:id",
    async ({ params, userRuntime }) => {
      const id = params.id;

      const res = await ServiceTenant.getById(userRuntime, id, {
        name: STenant.name,
        domain: STenant.domain,
        email: STenant.email,
        country: STenant.country,
        logoId: STenant.logoId,
        plan: STenant.plan,
        phones: STenant.phones,
        links: STenant.links,
        address: STenant.address,
        city: STenant.city,
        state: STenant.state,
        zipCode: STenant.zipCode,
        taxId: STenant.taxId,
        currency: STenant.currency,
        timezone: STenant.timezone,
        description: STenant.description,
        tagline: STenant.tagline,
        workingHours: STenant.workingHours,
        copyright: STenant.copyright,
      });

      return res;
    },
    {
      params: t.Object({
        id: VId,
      }),
      response: t.Object({
        name: VString,
        domain: VString,
        email: VEmail,
        country: VString,
        logoId: t.Nullable(VId),
        plan: VTenantPlan,
        phones: t.Array(t.String()),
        links: t.Array(t.String()),
        address: t.Nullable(VString),
        city: t.Nullable(VString),
        state: t.Nullable(VString),
        zipCode: t.Nullable(VString),
        taxId: t.Nullable(VString),
        currency: VString,
        timezone: VString,
        description: t.Nullable(VString),
        tagline: t.Nullable(VString),
        workingHours: t.Nullable(VString),
        copyright: t.Nullable(VString),
      }),
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
        domain: t.Optional(VString),
        country: t.Optional(VString),
        phones: t.Optional(t.Array(t.String())),
        links: t.Optional(t.Array(t.String())),
        address: t.Optional(VString),
        city: t.Optional(VString),
        state: t.Optional(VString),
        zipCode: t.Optional(VString),
        taxId: t.Optional(VString),
        currency: t.Optional(VString),
        timezone: t.Optional(VString),
        description: t.Optional(VString),
        tagline: t.Optional(t.Nullable(VString)),
        workingHours: t.Optional(t.Nullable(VString)),
        copyright: t.Optional(t.Nullable(VString)),
        email: t.Optional(VString),
        logoId: t.Optional(VId),
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
      audit: true,
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
            const tenant = await ServiceTenant.create(userRuntime, body);

            const randomBuffer = new Uint8Array(6);
            crypto.getRandomValues(randomBuffer);
            const password = Buffer.from(randomBuffer).toString("hex");

            await ServiceUser.create(
              { ...userRuntime, tenantId: tenant.id },
              {
                email: body.email,
                name: "Admin",
                role: EUserRole.ADMIN,
                password,
              },
            );

            return { id: tenant.id, password };
          },
          {
            body: t.Object({
              name: VString,
              domain: VString,
              country: VString,
              phones: t.Array(t.String()),
              links: t.Optional(t.Array(t.String())),
              address: t.Optional(VString),
              city: t.Optional(VString),
              state: t.Optional(VString),
              zipCode: t.Optional(VString),
              taxId: t.Optional(VString),
              currency: t.Optional(VString),
              timezone: t.Optional(VString),
              description: t.Optional(VString),
              tagline: t.Optional(t.Nullable(VString)),
              workingHours: t.Optional(t.Nullable(VString)),
              copyright: t.Optional(t.Nullable(VString)),
              email: VString,
              logoId: t.Optional(VId),
              plan: t.Union([
                t.Literal(ETenantPlan.BASIC),
                t.Literal(ETenantPlan.STANDARD),
                t.Literal(ETenantPlan.PROFESSIONAL),
              ]),
              planStart: t.Date(),
              planEnd: t.Date(),
            }),
            response: t.Object({
              id: VId,
              password: t.String(),
            }),

            audit: true,
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
            audit: true,
          },
        )
        .get(
          "/",
          async ({ query, userRuntime }) => {
            const res = await ServiceTenant.getAll(userRuntime, query, {
              id: STenant.id,
              name: STenant.name,
              domain: STenant.domain,
              country: STenant.country,
              logoId: STenant.logoId,
              email: STenant.email,
            });

            return res;
          },
          {
            query: VQuery,
            response: UtilRouter.defPaginatedSchema(
              t.Object({
                id: VId,
                name: VString,
                domain: VString,
                country: VString,
                logoId: t.Nullable(VId),
                email: VEmail,
              }),
            ),
          },
        ),
  );
