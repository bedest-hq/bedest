import { Elysia, status, t } from "elysia";
import Context from "@/app/Context";
import EnvManager from "@/infrastructure/env/EnvManager";
import RateLimitManager from "@/infrastructure/ratelimit/RateLimitManager";
import { EUserRole } from "@/features/user/enums/EUserRole";
import ServiceAuth from "../services/ServiceAuth";
import { UtilAuth } from "../utils/UtilAuth";
import { VId, VString } from "bedest-core";

const MINUTE_MS = 60 * 1000;

// Each limiter is mounted on its own instance with `scoping: "scoped"`, so
// it only applies to the routes of that instance (never the whole API).
const RouterLogin = new Elysia({ tags: ["Auth"] })
  .use(Context.App())
  .derive(({ body }) => ({ rateLimitEmail: UtilAuth.rateLimitEmail(body) }))
  .use(
    RateLimitManager.limiter({
      name: "login:ip",
      max: () => EnvManager.get().RATE_LIMIT_LOGIN_IP_PER_MIN,
      durationMs: MINUTE_MS,
      key: ({ clientIp }) => clientIp,
    }),
  )
  .use(
    RateLimitManager.limiter({
      name: "login:email",
      max: () => EnvManager.get().RATE_LIMIT_LOGIN_PER_MIN,
      durationMs: MINUTE_MS,
      key: ({ clientIp, rateLimitEmail }) => `${clientIp}|${rateLimitEmail}`,
    }),
  )
  .post(
    "/login",
    async ({ body, nowDatetime, db, refreshJwt, accessJwt, cookie }) => {
      const payload = await ServiceAuth.login(
        { nowDatetime, db },
        { email: body.email, password: body.password },
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
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 6, maxLength: 100 }),
      }),
      response: t.Object({ success: t.Boolean(), id: VId }),
    },
  );

const RouterRefresh = new Elysia({ tags: ["Auth"] })
  .use(Context.App())
  .use(
    RateLimitManager.limiter({
      name: "refresh:ip",
      max: () => EnvManager.get().RATE_LIMIT_REFRESH_PER_MIN,
      durationMs: MINUTE_MS,
      key: ({ clientIp }) => clientIp,
    }),
  )
  .post(
    "/refresh",
    async ({ accessJwt, refreshJwt, cookie, nowDatetime, db }) => {
      const refreshToken = cookie.refreshToken.value;

      if (!refreshToken) {
        throw status("Unauthorized");
      }

      const payload = await refreshJwt.verify(refreshToken as string);
      if (!payload) {
        throw status("Unauthorized");
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

export const RouterAuth = new Elysia({ prefix: "/auth", tags: ["Auth"] })
  .use(RouterLogin)
  .use(RouterRefresh)
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
