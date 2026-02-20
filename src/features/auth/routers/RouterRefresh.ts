import Context from "@/app/Context";
import { SString } from "@/common/schemas/SString";
import { UtilRouter } from "@/common/utils/UtilRouter";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { Elysia, t } from "elysia";
import { UtilAuth } from "../utils/UtilAuth";

export const RouterRefresh = new Elysia({
  prefix: "/auth",
  tags: ["Auth"],
})
  .use(Context.App())
  .post(
    "/refresh",
    async ({ accessJwt, refreshJwt, cookie, nowDatetime, db }) => {
      const refreshToken = cookie.refreshToken.value;
      const payload = await refreshJwt.verify(refreshToken as string);

      if (!refreshToken) {
        throw ErrorHandler.unauthorized("Refresh token missing");
      }

      if (!payload) {
        throw ErrorHandler.unauthorized("Invalid refresh token");
      }

      const isValid = await ServiceSession.isValid(
        { db, nowDatetime },
        payload.sessionId as string,
      );

      if (!isValid) {
        throw ErrorHandler.unauthorized("Session expired or invalid");
      }

      const newAccessToken = await accessJwt.sign({
        tenantId: payload.tenantId,
        userId: payload.userId,
        sessionId: payload.sessionId,
        role: payload.role,
      });

      cookie.accessToken.set({
        value: newAccessToken,
        ...UtilAuth.cookieConf("access"),
      });

      return UtilRouter.defResponse({ accessToken: newAccessToken });
    },
    {
      response: UtilRouter.defSchema(t.Object({ accessToken: SString })),
    },
  );
