import Context from "@/app/Context";
import { VString } from "@/common/validations/VString";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { Elysia, t } from "elysia";
import { UtilAuth } from "../utils/UtilAuth";
import { EUserRole } from "@f/user/enums/EUserRole";
import ServiceAuth from "../services/ServiceAuth";

export const RouterRefresh = new Elysia({
  prefix: "/auth",
  tags: ["Auth"],
})
  .use(Context.App())
  .post(
    "/refresh",
    async ({ accessJwt, refreshJwt, cookie, nowDatetime, db }) => {
      const refreshToken = cookie.refreshToken.value;
      if (!refreshToken) {
        throw ErrorHandler.unauthorized("Refresh token missing");
      }

      const payload = await refreshJwt.verify(refreshToken as string);
      if (!payload) {
        throw ErrorHandler.unauthorized("Invalid refresh token");
      }

      const newPayload = await ServiceAuth.refresh(
        { db, nowDatetime },
        {
          sessionId: payload.sessionId as string,
          tenantId: payload.tenantId as string,
          userId: payload.userId as string,
          role: payload.role as EUserRole,
        },
      );

      const newAccessToken = await accessJwt.sign(newPayload);
      const newRefreshToken = await refreshJwt.sign(newPayload);

      cookie.accessToken.set({
        value: newAccessToken,
        ...UtilAuth.cookieConf("access"),
      });

      cookie.refreshToken.set({
        value: newRefreshToken,
        ...UtilAuth.cookieConf("refresh"),
      });

      return { accessToken: newAccessToken };
    },
    {
      response: t.Object({ accessToken: VString }),
    },
  );
