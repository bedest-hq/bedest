import { UtilHttp } from "@/common/utils/UtilHttp";
import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import EnvManager from "@/infrastructure/env/EnvManager";
import RateLimitManager from "@/infrastructure/ratelimit/RateLimitManager";
import ServiceAuth from "../services/ServiceAuth";
import ServiceSession from "@f/session/services/ServiceSession";
import { UtilAuth } from "../utils/UtilAuth";
import { VPassword, VPasswordCheck } from "../validations/VPassword";
import { VUserToken } from "../validations/VUserToken";
import ServicePasswordReset from "../services/ServicePasswordReset";
import ServiceInvite from "@f/user/services/ServiceInvite";
import { VUserInput } from "@f/user/validations/VUserInput";
import { VEmail, VId } from "bedest-core";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

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
    async ({
      body,
      nowDatetime,
      db,
      refreshJwt,
      accessJwt,
      cookie,
      clientIp,
      request,
    }) => {
      const payload = await ServiceAuth.login(
        { nowDatetime, db },
        { email: body.email, password: body.password },
        // For the failed-login audit [FEAT-07].
        {
          ip: clientIp,
          userAgent: request.headers.get("user-agent") ?? "",
        },
      );

      const refreshToken = await refreshJwt.sign({
        ...payload,
        typ: "refresh",
      });
      const accessToken = await accessJwt.sign({ ...payload, typ: "access" });

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
        email: VEmail,
        password: VPasswordCheck,
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
    async ({
      accessJwt,
      refreshJwt,
      cookie,
      nowDatetime,
      db,
      clientIp,
      request,
    }) => {
      const refreshToken = cookie.refreshToken.value;

      if (!refreshToken) {
        throw UtilHttp.fail(401);
      }

      const payload = await refreshJwt.verify(
        refreshToken,
        UtilAuth.jwtVerifyOptions(),
      );
      if (!payload) {
        throw UtilHttp.fail(401);
      }

      // Only the session id is taken from the token; identity and role are
      // re-read from the database [SEC-08].
      const newPayload = await ServiceAuth.refresh(
        { db, nowDatetime },
        payload.sessionId,
        // The session shows the device that last refreshed it [FEAT-05].
        { ip: clientIp, userAgent: request.headers.get("user-agent") ?? "" },
      );

      const newAccessToken = await accessJwt.sign({
        ...newPayload,
        typ: "access",
      });
      const newRefreshToken = await refreshJwt.sign({
        ...newPayload,
        typ: "refresh",
      });

      cookie.accessToken.set({
        value: newAccessToken,
        ...UtilAuth.cookieConf("access"),
      });

      cookie.refreshToken.set({
        value: newRefreshToken,
        ...UtilAuth.cookieConf("refresh"),
      });

      // Tokens are only ever sent as HttpOnly cookies [SEC-14].
      return { success: true };
    },
    {
      cookie: t.Cookie({ refreshToken: t.Optional(t.String()) }),
      response: t.Object({ success: t.Boolean() }),
    },
  );

// Account e-mail flows [FEAT-06]: the reset request has its own limiters
// (per IP, and per e-mail per hour).
const RouterPasswordForgot = new Elysia({ tags: ["Auth"] })
  .use(Context.App())
  .derive(({ body }) => ({ rateLimitEmail: UtilAuth.rateLimitEmail(body) }))
  .use(
    RateLimitManager.limiter({
      name: "forgot:ip",
      max: () => EnvManager.get().RATE_LIMIT_PASSWORD_FORGOT_PER_MIN,
      durationMs: MINUTE_MS,
      key: ({ clientIp }) => clientIp,
    }),
  )
  .use(
    RateLimitManager.limiter({
      name: "forgot:email",
      max: () => EnvManager.get().RATE_LIMIT_PASSWORD_FORGOT_PER_HOUR,
      durationMs: HOUR_MS,
      key: ({ rateLimitEmail }) => rateLimitEmail,
    }),
  )
  .post(
    "/password/forgot",
    async ({ body, db, nowDatetime, set }) => {
      await ServicePasswordReset.forgot({ db, nowDatetime }, body.email);
      // Same answer whether or not the address exists.
      set.status = 202;
      return { success: true };
    },
    {
      body: t.Object({ email: VEmail }),
      response: { 202: t.Object({ success: t.Boolean() }) },
    },
  );

const RouterAccountTokens = new Elysia({ tags: ["Auth"] })
  .use(Context.App())
  .post(
    "/password/reset",
    async ({ body, db, nowDatetime }) => {
      await ServicePasswordReset.reset(
        { db, nowDatetime },
        body.token,
        body.password,
      );
      return { success: true };
    },
    {
      body: t.Object({ token: VUserToken, password: VPassword }),
      response: t.Object({ success: t.Boolean() }),
    },
  )
  .post(
    "/invite/accept",
    async ({
      body,
      db,
      nowDatetime,
      accessJwt,
      refreshJwt,
      cookie,
      clientIp,
      request,
    }) => {
      const payload = await ServiceInvite.accept({ db, nowDatetime }, body, {
        ip: clientIp,
        userAgent: request.headers.get("user-agent") ?? "",
      });

      // Signed in right away, like a login.
      const refreshToken = await refreshJwt.sign({
        ...payload,
        typ: "refresh",
      });
      const accessToken = await accessJwt.sign({ ...payload, typ: "access" });
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
        token: VUserToken,
        name: VUserInput.name,
        password: VPassword,
      }),
      response: t.Object({ success: t.Boolean(), id: VId }),
    },
  );

export const RouterAuth = new Elysia({ prefix: "/auth", tags: ["Auth"] })
  .use(RouterLogin)
  .use(RouterRefresh)
  .use(RouterPasswordForgot)
  .use(RouterAccountTokens)
  .guard({}, (app) =>
    app
      .use(Context.User())
      .post(
        "/logout",
        async ({ userRuntime, cookie }) => {
          await ServiceAuth.logout(userRuntime);

          // Same path as when set, or the browser keeps the cookie [SEC-24].
          cookie.accessToken.set(UtilAuth.clearedCookie("access"));
          cookie.refreshToken.set(UtilAuth.clearedCookie("refresh"));

          return { success: true };
        },
        {
          response: t.Object({ success: t.Boolean() }),
        },
      )
      // Session management [FEAT-05].
      .get(
        "/sessions",
        async ({ userRuntime }) =>
          await ServiceSession.listForUser(userRuntime),
        {
          response: t.Array(
            t.Object({
              id: VId,
              createdAt: t.Date(),
              lastUsedAt: t.Nullable(t.Date()),
              ipAddress: t.Nullable(t.String()),
              userAgent: t.Nullable(t.String()),
              current: t.Boolean(),
            }),
          ),
        },
      )
      .delete(
        "/sessions/:id",
        async ({ params, userRuntime, cookie }) => {
          if (!(await ServiceSession.revokeOwn(userRuntime, params.id))) {
            throw UtilHttp.fail(404, "Session not found");
          }
          // Revoking the current session signs this device out too.
          if (params.id === userRuntime.session.sessionId) {
            cookie.accessToken.set(UtilAuth.clearedCookie("access"));
            cookie.refreshToken.set(UtilAuth.clearedCookie("refresh"));
          }
          return { success: true };
        },
        {
          params: t.Object({ id: VId }),
          response: t.Object({ success: t.Boolean() }),
          audit: { entity: "session", action: "SESSION_REVOKED" },
        },
      )
      .post(
        "/logout-all",
        async ({ body, userRuntime, cookie }) => {
          const revoked = await ServiceSession.revokeUserSessions(
            userRuntime,
            userRuntime.session.userId,
            {
              exceptSessionId: body.includeCurrent
                ? undefined
                : userRuntime.session.sessionId,
            },
          );
          if (body.includeCurrent) {
            cookie.accessToken.set(UtilAuth.clearedCookie("access"));
            cookie.refreshToken.set(UtilAuth.clearedCookie("refresh"));
          }
          return { success: true, revoked };
        },
        {
          body: t.Object({ includeCurrent: t.Boolean() }),
          response: t.Object({ success: t.Boolean(), revoked: t.Number() }),
          audit: { entity: "session", action: "SESSION_REVOKED" },
        },
      ),
  );
