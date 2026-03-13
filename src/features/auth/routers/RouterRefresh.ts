import Context from "@/app/Context";
import { SString } from "@/common/schemas/SString";
import { UtilRouter } from "@/common/utils/UtilRouter";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { Elysia, t } from "elysia";
import { UtilAuth } from "../utils/UtilAuth";
import { EUserRole } from "@f/user/enums/EUserRole";

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

      const tokenValues = {
        tenantId: payload.tenantId as string,
        session: {
          userId: payload.userId as string,
          role: payload.role as EUserRole,
          sessionId: payload.sessionId as string,
        },
      };

      await ServiceSession.remove(
        {
          db,
          nowDatetime,
          ...tokenValues,
        },
        payload.sessionId as string,
      );

      const newSession = await ServiceSession.create(
        { db, nowDatetime },
        {
          tenantId: tokenValues.tenantId,
          userId: tokenValues.session.userId,
        },
      );

      const newAccessToken = await accessJwt.sign({
        tenantId: tokenValues.tenantId,
        userId: tokenValues.session.userId,
        sessionId: newSession.id,
        role: tokenValues.session.role,
      });

      const newRefreshToken = await refreshJwt.sign({
        tenantId: tokenValues.tenantId,
        userId: tokenValues.session.userId,
        sessionId: newSession.id,
        role: tokenValues.session.role,
      });

      cookie.accessToken.set({
        value: newAccessToken,
        ...UtilAuth.cookieConf("access"),
      });

      cookie.refreshToken.set({
        value: newRefreshToken,
        ...UtilAuth.cookieConf("refresh"),
      });

      return UtilRouter.defResponse({ accessToken: newAccessToken });
    },
    {
      response: UtilRouter.defSchema(t.Object({ accessToken: SString })),
    },
  );
