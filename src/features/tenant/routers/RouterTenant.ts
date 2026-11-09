import { Elysia, t } from "elysia";
import { STenant } from "../schemas/STenant";
import ServiceTenant from "../services/ServiceTenant";
import Context from "@/app/Context";
import { EUserRole } from "@f/user/enums/EUserRole";
import { VTenantPlan } from "../validations/VTenantPlan";
import { VTenantInput } from "../validations/VTenantInput";
import { RouterTenantPublic } from "./RouterTenantPublic";
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
      // Own tenant only unless SYSTEM: enforced by the service [BUG-15].
      const res = await ServiceTenant.getById(userRuntime, params.id, {
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
      // Authorization (own tenant, plan fields SYSTEM-only) is enforced by
      // the service; the body is passed unchanged [BUG-15].
      return await ServiceTenant.update(userRuntime, params.id, body);
    },
    {
      RoleGuard: [EUserRole.ADMIN, EUserRole.SYSTEM],
      params: t.Object({
        id: VId,
      }),
      body: t.Object({
        name: t.Optional(VTenantInput.name),
        domain: t.Optional(VTenantInput.domain),
        country: t.Optional(VTenantInput.country),
        phones: t.Optional(VTenantInput.phones),
        links: t.Optional(VTenantInput.links),
        address: t.Optional(VTenantInput.address),
        city: t.Optional(VTenantInput.city),
        state: t.Optional(VTenantInput.state),
        zipCode: t.Optional(VTenantInput.zipCode),
        taxId: t.Optional(VTenantInput.taxId),
        currency: t.Optional(VTenantInput.currency),
        timezone: t.Optional(VTenantInput.timezone),
        description: t.Optional(VTenantInput.description),
        tagline: t.Optional(t.Nullable(VTenantInput.tagline)),
        workingHours: t.Optional(t.Nullable(VTenantInput.workingHours)),
        copyright: t.Optional(t.Nullable(VTenantInput.copyright)),
        email: t.Optional(VEmail),
        logoId: t.Optional(VId),
        plan: t.Optional(VTenantPlan),
        planStart: t.Optional(t.Date()),
        planEnd: t.Optional(t.Date()),
      }),
      audit: { entity: "tenant", targetTenant: "entity" },
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
            // Tenant and ADMIN in one transaction [BUG-16].
            return await ServiceTenant.createWithAdmin(userRuntime, body);
          },
          {
            body: t.Object({
              name: VTenantInput.name,
              domain: VTenantInput.domain,
              country: VTenantInput.country,
              phones: VTenantInput.phones,
              links: t.Optional(VTenantInput.links),
              address: t.Optional(VTenantInput.address),
              city: t.Optional(VTenantInput.city),
              state: t.Optional(VTenantInput.state),
              zipCode: t.Optional(VTenantInput.zipCode),
              taxId: t.Optional(VTenantInput.taxId),
              currency: t.Optional(VTenantInput.currency),
              timezone: t.Optional(VTenantInput.timezone),
              description: t.Optional(VTenantInput.description),
              tagline: t.Optional(t.Nullable(VTenantInput.tagline)),
              workingHours: t.Optional(t.Nullable(VTenantInput.workingHours)),
              copyright: t.Optional(t.Nullable(VTenantInput.copyright)),
              email: VEmail,
              // No logoId: a new tenant owns no file yet; set it with PUT
              // after uploading [SEC-27].
              plan: VTenantPlan,
              planStart: t.Date(),
              planEnd: t.Date(),
            }),
            response: t.Object({
              id: VId,
              password: t.String(),
            }),

            audit: { entity: "tenant", targetTenant: "entity" },
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
            audit: { entity: "tenant", targetTenant: "entity" },
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
