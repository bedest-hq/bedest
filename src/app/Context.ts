import { UtilHttp } from "@/common/utils/UtilHttp";
import { jwt } from "@elysiajs/jwt";
import Elysia from "elysia";
import { t } from "elysia";
import { EUserRole } from "@/features/user/enums/EUserRole";
import DbManager from "@/infrastructure/database/DbManager";
import EnvManager from "@/infrastructure/env/EnvManager";
import { TEnv } from "@/common/types/TEnv";
import { UtilClientIp } from "@/infrastructure/ratelimit/UtilClientIp";
import ServiceSystem from "@f/system/services/ServiceSystem";
import ServiceSession from "@f/session/services/ServiceSession";
import { UtilAuth } from "@f/auth/utils/UtilAuth";
import {
  JWT_AUDIENCE,
  VAccessJwtPayload,
  VRefreshJwtPayload,
} from "@f/auth/validations/VJwtPayload";
import { PluginAudit } from "@f/system/plugins/PluginAudit";
import { ISession, ITenantUserApp, MacroRoleGuard } from "bedest-core";

/** The access and refresh token signers for `env` (SEC-24 claims). */
const createSigners = (env: TEnv) => ({
  refreshJwt: jwt({
    name: "refreshJwt",
    secret: env.REFRESH_KEY,
    exp: "7d",
    iat: true,
    iss: env.JWT_ISSUER,
    aud: JWT_AUDIENCE,
    schema: VRefreshJwtPayload,
  }).decorator.refreshJwt,
  accessJwt: jwt({
    name: "accessJwt",
    secret: env.SECRET_KEY,
    exp: "15m",
    iat: true,
    iss: env.JWT_ISSUER,
    aud: JWT_AUDIENCE,
    schema: VAccessJwtPayload,
  }).decorator.accessJwt,
});

class Context {
  private signers: ReturnType<typeof createSigners> | undefined;

  /**
   * Routers are built when their module is imported, so nothing here may
   * read the environment or the database at that point [QLT-01]: the
   * signers are created on first use and the database handle is resolved
   * per request.
   */
  private jwt() {
    this.signers ??= createSigners(EnvManager.get());
    return this.signers;
  }

  App() {
    return (app: Elysia) =>
      app.derive(({ request, server }) => ({
        db: DbManager.get(),
        nowDatetime: new Date(),
        clientIp: UtilClientIp.resolve(
          request,
          server,
          EnvManager.get().TRUST_PROXY_HOPS,
        ),
        ...this.jwt(),
      }));
  }

  User() {
    return (app: Elysia) =>
      app
        .use(this.App())
        .guard({
          cookie: t.Cookie({ accessToken: t.Optional(t.String()) }),
        })
        .derive(async ({ accessJwt, nowDatetime, cookie }) => {
          const db = DbManager.get();
          const token = cookie.accessToken.value;
          const payload = await UtilAuth.validateAccessToken(accessJwt, token);

          // A valid signature is not enough: the session must still exist
          // (logout, revocation, deleted user/tenant) [SEC-08].
          if (
            !(await ServiceSession.isActive(
              { db, nowDatetime },
              payload.sessionId,
            ))
          ) {
            throw UtilHttp.fail(401);
          }

          if (
            (await ServiceSystem.getMaintenance({ db, nowDatetime })) &&
            payload.role !== EUserRole.SYSTEM
          ) {
            throw UtilHttp.fail(503);
          }

          const session: ISession = {
            userId: payload.userId,
            sessionId: payload.sessionId,
            role: payload.role,
            isSuperUser: payload.role === EUserRole.SYSTEM,
          };

          const userRuntime: ITenantUserApp = {
            db,
            tenantId: payload.tenantId,
            nowDatetime,
            session,
          };

          // WebSockets are closed when the token they were opened with
          // expires [BUG-10]; "exp" is always set (15 min tokens).
          const accessTokenExpiresAt =
            (payload.exp ?? Math.floor(Date.now() / 1000) + 15 * 60) * 1000;

          return { userRuntime, accessTokenExpiresAt };
        })
        .macro("RoleGuard", MacroRoleGuard)
        // PlanGuard is opt-in per router (UtilPlanGuard.macro); no route
        // of the template is plan-gated [QLT-05].
        .use(PluginAudit);
  }
}

export default new Context();
