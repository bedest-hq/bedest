import { Elysia, t } from "elysia";
import { SId } from "../../../common/schemas/SId";
import { SString } from "../../../common/schemas/SString";
import { TbExample } from "../tables/TbExample";
import ServiceExample from "../services/ServiceExample";
import Context from "@/app/Context";

export const RouterExample = new Elysia({
  prefix: "/example",
  tags: ["Example"],
}).use(Context.User());

RouterExample.get(
  "/:id",
  async ({ params, userRuntime }) => {
    return await ServiceExample.getById(
      userRuntime,
      {
        exampleColumn: TbExample.exampleColumn,
        otherExampleColumn: TbExample.otherExampleColumn,
      },
      params.id,
    );
  },
  {
    params: t.Object({
      id: SId,
    }),
    response: t.Object({
      exampleColumn: SString,
      otherExampleColumn: SString,
    }),
  },
);

RouterExample.get(
  "/",
  async ({ userRuntime }) => {
    return await ServiceExample.get(userRuntime, {
      exampleColumn: TbExample.exampleColumn,
      otherExampleColumn: TbExample.otherExampleColumn,
    });
  },
  {
    response: t.Array(
      t.Object({
        exampleColumn: SString,
        otherExampleColumn: SString,
      }),
    ),
  },
);

RouterExample.post(
  "/",
  async ({ body, userRuntime }) => {
    return await ServiceExample.create(userRuntime, body);
  },
  {
    body: t.Object({
      exampleColumn: SString,
      otherExampleColumn: SString,
    }),
  },
);

RouterExample.put(
  "/:id",
  async ({ params, userRuntime, body }) => {
    return await ServiceExample.update(userRuntime, params.id, body);
  },
  {
    params: t.Object({
      id: SId,
    }),
    body: t.Object({
      exampleColumn: t.Optional(SString),
      otherExampleColumn: t.Optional(SString),
    }),
  },
);

RouterExample.delete(
  "/:id",
  async ({ params, userRuntime }) => {
    return await ServiceExample.remove(userRuntime, params.id);
  },
  {
    params: t.Object({
      id: SId,
    }),
  },
);
