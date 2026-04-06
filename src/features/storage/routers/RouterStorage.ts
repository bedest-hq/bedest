import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import ServiceStorage from "../services/ServiceStorage";
import { VId, VQuery, VString } from "@/common/validations/VCommon";
import { UtilRouter } from "@/common/utils/UtilRouter";
import { SStorage } from "../schemas/SStorage";

export const RouterStorage = new Elysia({
  prefix: "/storage",
  tags: ["Storage"],
})
  .use(Context.User())
  .post(
    "/upload",
    async ({ body, userRuntime }) => {
      const res = await ServiceStorage.upload(userRuntime, body.file);
      return res;
    },
    {
      body: t.Object({
        file: t.File({
          maxSize: 5 * 1024 * 1024,
          type: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
        }),
      }),
      response: t.Object({
        id: VId,
        key: VString,
      }),
      audit: true,
    },
  )
  .get(
    "/",
    async ({ query, userRuntime }) => {
      const res = await ServiceStorage.getAll(userRuntime, query, {
        id: SStorage.id,
        name: SStorage.name,
        mimeType: SStorage.mimeType,
        size: SStorage.size,
        createdAt: SStorage.createdAt,
      });
      return res;
    },
    {
      query: VQuery,
      response: UtilRouter.defPaginatedSchema(
        t.Object({
          id: VId,
          name: VString,
          mimeType: VString,
          size: t.Number(),
          createdAt: t.Date(),
        }),
      ),
    },
  )
  .delete(
    "/:id",
    async ({ params, userRuntime }) => {
      return await ServiceStorage.remove(userRuntime, params.id);
    },
    {
      params: t.Object({ id: VId }),
      audit: true,
    },
  )
  .get(
    "/:id/download",
    async ({ params, userRuntime, set }) => {
      const { fileBlob, metadata } = await ServiceStorage.get(
        userRuntime,
        params.id,
      );

      set.headers["Content-Type"] = metadata.mimeType;

      const encodedName = encodeURIComponent(metadata.name);
      set.headers["Content-Disposition"] =
        `attachment; filename*=UTF-8''${encodedName}`;

      return fileBlob;
    },
    { params: t.Object({ id: VId }) },
  )
  .get(
    "/:id/view",
    async ({ params, userRuntime, set }) => {
      const { fileBlob, metadata } = await ServiceStorage.get(
        userRuntime,
        params.id,
      );

      set.headers["Content-Type"] = metadata.mimeType;

      const encodedName = encodeURIComponent(metadata.name);

      set.headers["Content-Disposition"] =
        `inline; filename*=UTF-8''${encodedName}`;

      return fileBlob;
    },
    { params: t.Object({ id: VId }) },
  );
