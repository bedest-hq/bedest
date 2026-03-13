import { Elysia, t } from "elysia";
import { SId } from "../../../common/schemas/SId";
import { SString } from "../../../common/schemas/SString";
import { EUserRole } from "../enums/EUserRole";
import ServiceUser from "../services/ServiceUser";
import Context from "@/app/Context";
import { UtilRouter } from "@/common/utils/UtilRouter";

export const RouterUser = new Elysia({
  prefix: "/user",
  tags: ["User"],
})
  .use(Context.User())
  .get(
    "/:id",
    async ({ params, userRuntime }) => {
      const res = await ServiceUser.getById(userRuntime, params.id);
      return UtilRouter.defResponse(res);
    },
    {
      params: t.Object({
        id: SId,
      }),
      response: UtilRouter.defSchema(
        t.Object({
          name: SString,
          role: t.Enum(EUserRole),
          createdAt: t.Date(),
        }),
      ),
    },
  )
  .get(
    "/",
    async ({ userRuntime }) => {
      const res = await ServiceUser.getAll(userRuntime);
      return UtilRouter.defResponse(res);
    },
    {
      response: UtilRouter.defSchema(
        t.Array(
          t.Object({
            name: SString,
            role: t.Enum(EUserRole),
            createdAt: t.Date(),
          }),
        ),
      ),
    },
  )
  .post(
    "/",
    async ({ body, userRuntime }) => {
      const res = await ServiceUser.create(userRuntime, body);
      return UtilRouter.defResponse(res);
    },
    {
      body: t.Object({
        name: SString,
        phone: SString,
        email: SString,
        role: t.Enum(EUserRole),
        password: t.String({ minLength: 6 }),
        planStart: t.Date(),
        planEnd: t.Date(),
      }),
      response: UtilRouter.defSchema(t.Object({ id: SId })),
    },
  )
  .put(
    "/:id",
    async ({ params, body, userRuntime }) => {
      const res = await ServiceUser.update(userRuntime, params.id, body);
      return UtilRouter.defResponse(res);
    },
    {
      params: t.Object({ id: SId }),
      body: t.Object({
        name: t.Optional(SString),
        password: t.Optional(SString),
      }),
    },
  )
  .delete(
    "/:id",
    async ({ params, userRuntime }) => {
      return ServiceUser.remove(userRuntime, params.id);
    },
    {
      params: t.Object({
        id: SId,
      }),
    },
  );
