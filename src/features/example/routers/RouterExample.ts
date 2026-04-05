import { Elysia, t } from "elysia";
import { SExample } from "../schemas/SExample";
import ServiceExample from "../services/ServiceExample";
import Context from "@/app/Context";
import { UtilRouter } from "@/common/utils/UtilRouter";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import { VId, VQuery, VString } from "@/common/validations/VCommon";

export const RouterExample = new Elysia({
  prefix: "/example",
  tags: ["Example"],
})
  .use(Context.User())
  .guard(
    { PlanGuard: [ETenantPlan.STANDARD, ETenantPlan.PROFESSIONAL] },
    (app) =>
      app
        .get(
          "/:id",
          async ({ params, userRuntime }) => {
            const res = await ServiceExample.getById(userRuntime, params.id, {
              exampleColumn: SExample.exampleColumn,
              otherExampleColumn: SExample.otherExampleColumn,
            });
            return res;
          },
          {
            params: t.Object({
              id: VId,
            }),
            response: t.Object({
              exampleColumn: VString,
              otherExampleColumn: VString,
            }),
          },
        )
        .get(
          "/",
          async ({ query, userRuntime }) => {
            const res = await ServiceExample.getAll(userRuntime, query, {
              exampleColumn: SExample.exampleColumn,
              otherExampleColumn: SExample.otherExampleColumn,
            });

            return res;
          },
          {
            query: VQuery,
            response: UtilRouter.defPaginatedSchema(
              t.Object({
                exampleColumn: VString,
                otherExampleColumn: VString,
              }),
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
              exampleColumn: VString,
              otherExampleColumn: VString,
            }),
            audit: true,
          },
        )
        .put(
          "/:id",
          async ({ params, userRuntime, body }) => {
            return await ServiceExample.update(userRuntime, params.id, body);
          },
          {
            params: t.Object({
              id: VId,
            }),
            body: t.Object({
              exampleColumn: t.Optional(VString),
              otherExampleColumn: t.Optional(VString),
            }),
            audit: true,
          },
        )
        .delete(
          "/:id",
          async ({ params, userRuntime }) => {
            return await ServiceExample.remove(userRuntime, params.id);
          },
          {
            params: t.Object({
              id: VId,
            }),
            audit: true,
          },
        ),
  );
