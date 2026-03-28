import { Elysia, t } from "elysia";
import { EUserRole } from "../enums/EUserRole";
import ServiceUser from "../services/ServiceUser";
import Context from "@/app/Context";
import { UtilRouter } from "@/common/utils/UtilRouter";
import { VId, VQuery, VString } from "@/common/validations/VCommon";

export const RouterUser = new Elysia({
  prefix: "/user",
  tags: ["User"],
})
  .use(Context.User())
  .get(
    "/:id",
    async ({ params, userRuntime }) => {
      const res = await ServiceUser.getById(userRuntime, params.id);
      return res;
    },
    {
      params: t.Object({
        id: VId,
      }),
      response: t.Object({
        name: VString,
        role: t.Enum(EUserRole),
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
        password: t.Optional(VString),
      }),
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
            const res = await ServiceUser.getAll(userRuntime, query);
            return res;
          },
          {
            query: VQuery,
            response: UtilRouter.defPaginatedSchema(
              t.Object({
                name: VString,
                role: t.Enum(EUserRole),
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
              phone: VString,
              email: VString,
              role: t.Enum(EUserRole),
              password: t.String({ minLength: 6 }),
            }),
            response: t.Object({ id: VId }),
          },
        )
        .delete(
          "/:id",
          async ({ params, userRuntime }) => {
            return ServiceUser.remove(userRuntime, params.id);
          },
          {
            params: t.Object({
              id: VId,
            }),
          },
        ),
  );
