import { Elysia, status, t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import Context from "@/app/Context";
import EnvManager from "@/infrastructure/env/EnvManager";
import { EXAMPLE_EMAIL, EXAMPLE_USER_PASSWORD } from "@/common/constants";
import { EUserRole } from "@/features/user/enums/EUserRole";
import ServiceAuth from "../services/ServiceAuth";
import { UtilAuth } from "../utils/UtilAuth";
import { VId, VString } from "@/common/validations/VCommon";

const env = EnvManager.get();

export const RouterAuth = new Elysia({ prefix: "/auth", tags: ["Auth"] })

  .guard({}, (app) =>
    app
      .use(Context.App())
      .use(
        rateLimit({
          max: 5,
          duration: 60 * 1000,
          skip: () => env.NODE_ENV === "test",
        }),
      )
      .post(
        "/login",
        async ({ body, nowDatetime, db, refreshJwt, accessJwt, cookie }) => {
          const payload = await ServiceAuth.login(
            { nowDatetime, db },
            {
              email: body.email ?? EXAMPLE_EMAIL,
              password: body.password ?? EXAMPLE_USER_PASSWORD,
            },
          );

          const refreshToken = await refreshJwt.sign(payload);
          const accessToken = await accessJwt.sign(payload);

          cookie.refreshToken.set({
            value: refreshToken,
            ...UtilAuth.cookieConf("refresh"),
          });

          cookie.accessToken.set({
            value: accessToken,
            ...UtilAuth.cookieConf("access"),
          });

          return { success: true, id: payload.userId };
        },
        {
          body: t.Object({
            email: t.String({
              format: "email",
              ...(env.NODE_ENV === "development" && {
                default: EXAMPLE_EMAIL,
              }),
            }),
            password: t.String({
              minLength: 6,
              ...(env.NODE_ENV === "development" && {
                default: EXAMPLE_USER_PASSWORD,
              }),
            }),
          }),
          response: t.Object({ success: t.Boolean(), id: VId }),
        },
      )
      .post(
        "/refresh",
        async ({ accessJwt, refreshJwt, cookie, nowDatetime, db }) => {
          const refreshToken = cookie.refreshToken.value;

          if (!refreshToken) {
            throw status(401, "Refresh token missing");
          }

          const payload = await refreshJwt.verify(refreshToken as string);
          if (!payload) {
            throw status(401, "Invalid refresh token");
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
      ),
  )

  .guard({}, (app) =>
    app.use(Context.User()).post(
      "/logout",
      async ({ userRuntime, cookie }) => {
        await ServiceAuth.logout(userRuntime);

        cookie.accessToken.remove();
        cookie.refreshToken.remove();

        return { success: true };
      },
      {
        response: t.Object({ success: t.Boolean() }),
      },
    ),
  );
