import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import ServiceSystemLog from "../services/ServiceSystemLog";
import { EUserRole } from "@/features/user/enums/EUserRole";
import { VId, VString } from "bedest-core";
import { VCursor, VCursorPage } from "@/common/validations/VPagination";

export const RouterSystemLog = new Elysia({
  prefix: "/log",
  tags: ["System"],
})
  .use(Context.User())
  .guard(
    {
      RoleGuard: [EUserRole.ADMIN, EUserRole.SYSTEM],
    },
    (app) =>
      app
        .get(
          "/",
          async ({ query, userRuntime }) => {
            const res = await ServiceSystemLog.getAll(userRuntime, query);
            return res;
          },
          {
            query: t.Object({
              limit: t.Numeric({ default: 20, minimum: 1, maximum: 100 }),
              page: t.Numeric({ default: 1, minimum: 1 }),
              action: t.Optional(t.String()),
              entity: t.Optional(t.String()),
              entityId: t.Optional(VId),
              userId: t.Optional(VId),
              // Keyset pagination; page is ignored when set [PERF-02].
              cursor: VCursor,
            }),
            response: VCursorPage(
              t.Object({
                id: VId,
                userId: VId,
                action: VString,
                entity: VString,
                entityId: t.Nullable(VId),
                targetTenantId: t.Nullable(VId),
                payload: t.Record(t.String(), t.Unknown()),
                createdAt: t.Date(),
              }),
            ),
          },
        )
        .get(
          "/:id",
          async ({ params, userRuntime }) => {
            const res = await ServiceSystemLog.getById(userRuntime, params.id);
            return res;
          },
          {
            params: t.Object({
              id: VId,
            }),
            response: t.Object({
              id: VId,
              userId: VId,
              action: VString,
              entity: VString,
              entityId: t.Nullable(VId),
              targetTenantId: t.Nullable(VId),
              payload: t.Record(t.String(), t.Unknown()),
              createdAt: t.Date(),
            }),
          },
        ),
  );
