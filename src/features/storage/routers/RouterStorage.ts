import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import ServiceStorage from "../services/ServiceStorage";
import { SStorage } from "../schemas/SStorage";
import { UtilStorage } from "../utils/UtilStorage";
import { UtilRouter, VId, VQuery, VString } from "bedest-core";

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
        // The shared allowlist and size limit (also used by presign) [SEC-10].
        file: t.File({
          maxSize: UtilStorage.maxBytes(),
          type: UtilStorage.allowedTypes(),
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

      Object.assign(set.headers, UtilStorage.fileHeaders(metadata, "attachment"));

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

      // Inline only for inline-safe types; always nosniff + sandbox [SEC-10].
      Object.assign(set.headers, UtilStorage.fileHeaders(metadata, "inline"));

      return fileBlob;
    },
    { params: t.Object({ id: VId }) },
  )
  .post(
    "/presign-upload",
    async ({ body, userRuntime }) => {
      const res = await ServiceStorage.presignUpload(userRuntime, body);
      return res;
    },
    {
      body: t.Object({
        name: VString,
        mimeType: VString,
        size: t.Integer({ minimum: 1 }),
      }),
      response: t.Object({
        uploadUrl: VString,
        key: VString,
        id: VId,
      }),
      audit: true,
    },
  )
  .get(
    "/:id/presign-download",
    async ({ params, userRuntime }) => {
      const res = await ServiceStorage.presignDownload(userRuntime, params.id);
      return res;
    },
    {
      params: t.Object({ id: VId }),
      response: t.Object({
        downloadUrl: VString,
      }),
    },
  );
