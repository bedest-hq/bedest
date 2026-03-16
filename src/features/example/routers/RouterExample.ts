import { Elysia, t } from "elysia";
import { SId } from "../../../common/schemas/SId";
import { SString } from "../../../common/schemas/SString";
import { TbExample } from "../tables/TbExample";
import ServiceExample from "../services/ServiceExample";
import Context from "@/app/Context";
import { UtilRouter } from "@/common/utils/UtilRouter";
import { SQuery } from "@/common/schemas/SQuery";

export const RouterExample = new Elysia({
  prefix: "/example",
  tags: ["Example"],
})
  .use(Context.User())
  .get(
    "/:id",
    async ({ params, userRuntime }) => {
      const res = await ServiceExample.getById(userRuntime, params.id, {
        exampleColumn: TbExample.exampleColumn,
        otherExampleColumn: TbExample.otherExampleColumn,
      });
      return UtilRouter.defResponse(res);
    },
    {
      params: t.Object({
        id: SId,
      }),
      response: UtilRouter.defSchema(
        t.Object({
          exampleColumn: SString,
          otherExampleColumn: SString,
        }),
      ),
    },
  )
  .get(
    "/",
    async ({ query, userRuntime }) => {
      const res = await ServiceExample.getAll(userRuntime, query, {
        exampleColumn: TbExample.exampleColumn,
        otherExampleColumn: TbExample.otherExampleColumn,
      });

      return UtilRouter.defResponse(res);
    },
    {
      query: SQuery,
      response: UtilRouter.defSchema(
        t.Array(
          t.Object({
            exampleColumn: SString,
            otherExampleColumn: SString,
          }),
        ),
      ),
    },
  )
  .post(
    "/",
    async ({ body, userRuntime }) => {
      const res = await ServiceExample.create(userRuntime, body);

      return res;
    },
    {
      body: t.Object({
        exampleColumn: SString,
        otherExampleColumn: SString,
      }),
    },
  )
  .put(
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
  )
  .delete(
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
