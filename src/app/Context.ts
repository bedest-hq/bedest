import { jwt } from "@elysiajs/jwt";
import Elysia, { status } from "elysia";
import { t } from "elysia";
import { EUserRole } from "@/features/user/enums/EUserRole";
import DbManager from "@/infrastructure/database/DbManager";
import EnvManager from "@/infrastructure/env/EnvManager";
import { UtilClientIp } from "@/infrastructure/ratelimit/UtilClientIp";
import ServiceSystem from "@f/system/services/ServiceSystem";
import ServiceSession from "@f/session/services/ServiceSession";
import ServiceTenant from "@f/tenant/services/ServiceTenant";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import { UtilAuth } from "@f/auth/utils/UtilAuth";
import { VJwtPayload } from "@f/auth/validations/VJwtPayload";
import { PluginAudit } from "@f/system/plugins/PluginAudit";
import {
  ISession,
  ITenantApp,
  ITenantUserApp,
  MacroPlanGuard,
  MacroRoleGuard,
  PlanChecker,
} from "bedest-core";

class Context {
  private env = EnvManager.get();

  private refreshPlugin = jwt({
    name: "refreshJwt",
    secret: this.env.REFRESH_KEY!,
    exp: "7d",
    iat: true,
    schema: VJwtPayload,
  });

  private accessPlugin = jwt({
    name: "accessJwt",
    secret: this.env.SECRET_KEY!,
    exp: "15m",
    iat: true,
    schema: VJwtPayload,
  });

  App() {
    const db = DbManager.get();
    return (app: Elysia) =>
      app
        .decorate("db", db)
        .derive(({ request, server }) => ({
          nowDatetime: new Date(),
          clientIp: UtilClientIp.resolve(
            request,
            server,
            EnvManager.get().TRUST_PROXY_HOPS,
          ),
        }))
        .use(this.refreshPlugin)
        .use(this.accessPlugin);
  }

  Tenant() {
    return (app: Elysia) =>
      app.use(this.App()).derive(({ request, db, nowDatetime }) => {
        const tenantId = request.headers.get("x-tenant-id");
        if (!tenantId) {
          throw status("Bad Request", "Missing x-tenant-id header");
        }
        const tenantRuntime: ITenantApp = { db, nowDatetime, tenantId };
        return { tenantRuntime };
      });
  }

  User() {
    const planChecker: PlanChecker = (tenantId, nowDatetime) => {
      const db = DbManager.get();
      return ServiceTenant.checkPlan({ db, nowDatetime }, tenantId);
    };

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
          if (!(await ServiceSession.isActive({ db, nowDatetime }, payload.sessionId))) {
            throw status("Unauthorized");
          }

          if (
            (await ServiceSystem.getMaintenance()) &&
            payload.role !== EUserRole.SYSTEM
          ) {
            throw status("Service Unavailable");
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

          return { userRuntime };
        })
        .macro("RoleGuard", MacroRoleGuard)
        .macro("PlanGuard", (plans: ETenantPlan[]) =>
          MacroPlanGuard(plans, planChecker),
        )
        .use(PluginAudit);
  }
}

export default new Context();
