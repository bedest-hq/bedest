import { Elysia, t } from "elysia";
import { EUserRole } from "../enums/EUserRole";
import ServiceUser from "../services/ServiceUser";
import { VUserRole } from "../validations/VUserRole";
import Context from "@/app/Context";
import { VPassword, VPasswordCheck } from "@f/auth/validations/VPassword";
import { UtilRouter, VEmail, VId, VQuery, VString } from "bedest-core";

export const RouterUser = new Elysia({
  prefix: "/user",
  tags: ["User"],
})
  .use(Context.User())
  .get(
    "/self",
    async ({ userRuntime }) => {
      const res = await ServiceUser.getProfile(
        userRuntime,
        userRuntime.session.userId,
      );
      return res;
    },
    {
      response: t.Object({
        name: VString,
        role: VUserRole,
        avatarId: t.Nullable(VId),
        email: VEmail,
        createdAt: t.Date(),
      }),
    },
  )
  .get(
    "/:id",
    async ({ params, userRuntime }) => {
      const res = await ServiceUser.getProfile(userRuntime, params.id);
      return res;
    },
    {
      params: t.Object({
        id: VId,
      }),
      response: t.Object({
        name: VString,
        role: VUserRole,
        avatarId: t.Nullable(VId),
        createdAt: t.Date(),
      }),
    },
  )
  .put(
    "/:id",
    async ({ params, body, userRuntime }) => {
      const res = await ServiceUser.update(userRuntime, params.id, body);
      return res;
    },
    {
      params: t.Object({ id: VId }),
      body: t.Object({
        name: t.Optional(VString),
        currentPassword: t.Optional(VPasswordCheck),
        password: t.Optional(VPassword),
        // A READY file of the user's tenant, or null to clear [SEC-27].
        avatarId: t.Optional(t.Nullable(VId)),
        // Assigning a role goes through UtilUserPolicy [SEC-12].
        role: t.Optional(VUserRole),
      }),
      audit: { entity: "user", targetTenant: "user" },
    },
  )
  .guard(
    {
      RoleGuard: [EUserRole.ADMIN, EUserRole.SYSTEM],
    },
    (app) =>
      app
        .get(
          "/",
          async ({ query, userRuntime }) => {
            const res = await ServiceUser.list(userRuntime, query);
            return res;
          },
          {
            query: VQuery,
            response: UtilRouter.defPaginatedSchema(
              t.Object({
                id: VId,
                tenantId: VId,
                name: VString,
                role: VUserRole,
                avatarId: t.Nullable(VId),
                createdAt: t.Date(),
              }),
            ),
          },
        )
        .post(
          "/",
          async ({ body, userRuntime }) => {
            const res = await ServiceUser.create(userRuntime, body);
            return res;
          },
          {
            body: t.Object({
              name: VString,
              email: VEmail,
              role: VUserRole,
              password: VPassword,
            }),
            audit: { entity: "user", targetTenant: "user" },
            response: t.Object({ id: VId }),
          },
        )
        .delete(
          "/:id",
          async ({ params, userRuntime }) => {
            return await ServiceUser.remove(userRuntime, params.id);
          },
          {
            params: t.Object({
              id: VId,
            }),
            audit: { entity: "user", targetTenant: "user" },
          },
        ),
  );
