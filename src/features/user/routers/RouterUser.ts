import { Elysia, t } from "elysia";
import { SId } from "../../../common/schemas/SId";
import { SString } from "../../../common/schemas/SString";
import { EUserRole } from "../enums/EUserRole";
import ServiceUser from "../services/ServiceUser";
import Context from "@/app/Context";

export const RouterUser = new Elysia({
  prefix: "/user",
  tags: ["User"],
}).use(Context.User());

RouterUser.get(
  "/:id",
  async ({ params, userRuntime }) => {
    return ServiceUser.getById(userRuntime, params.id);
  },
  {
    params: t.Object({
      id: SId,
    }),
    response: t.Object({
      name: SString,
      role: t.Enum(EUserRole),
      createdAt: t.Date(),
    }),
  },
);

RouterUser.get(
  "/",
  async ({ userRuntime }) => {
    return ServiceUser.get(userRuntime);
  },
  {
    response: t.Array(
      t.Object({
        name: SString,
        role: t.Enum(EUserRole),
        createdAt: t.Date(),
      }),
    ),
  },
);

RouterUser.post(
  "/",
  async ({ body, userRuntime }) => {
    return ServiceUser.create(userRuntime, body);
  },
  {
    body: t.Object({
      name: SString,
      phone: SString,
      email: SString,
      role: t.Enum(EUserRole),
      password: SString,
      planStart: t.Date(),
      planEnd: t.Date(),
    }),
  },
);

RouterUser.put(
  "/:id",
  async ({ body, userRuntime }) => {
    return ServiceUser.update(userRuntime, body);
  },
  {
    body: t.Object({
      name: t.Optional(SString),
      password: t.Optional(SString),
    }),
  },
);

RouterUser.delete(
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
