import { jwt } from "@elysiajs/jwt";
import Elysia, { status } from "elysia";
import { t } from "elysia";
import { IUserApp, ITenantApp } from "../common/interfaces/IContextApp";
import { ISession } from "../features/session/interfaces/ISession";
import { EUserRole } from "../features/user/enums/EUserRole";
import DbManager from "@/infrastructure/database/DbManager";
import EnvManager from "@/infrastructure/env/EnvManager";
import ServiceSystem from "@f/system/services/ServiceSystem";
import { UtilAuth } from "@f/auth/utils/UtilAuth";
import { VJwtPayload } from "@f/auth/validations/VJwtPayload";
import { MacroRoleGuard } from "@/common/guards/GuardRole";
import { MacroPlanGuard } from "@/common/guards/GuardPlan";
import { PluginAudit } from "@f/system/plugins/PluginAudit";

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
        .derive(() => ({
          nowDatetime: new Date(),
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

        const tenantRuntime: ITenantApp = {
          db,
          nowDatetime,
          tenantId,
        };

        return { tenantRuntime };
      });
  }

  User() {
    return (app: Elysia) =>
      app
        .use(this.App())
        .guard({
          cookie: t.Cookie({
            accessToken: t.Optional(t.String()),
          }),
        })
        .derive(async ({ accessJwt, nowDatetime, cookie }) => {
          const db = DbManager.get();

          const token = cookie.accessToken.value;

          const payload = await UtilAuth.validateAccessToken(accessJwt, token);

          if (
            ServiceSystem.getMaintenance() &&
            payload.role !== EUserRole.SYSTEM
          ) {
            throw status("Service Unavailable");
          }

          const session: ISession = {
            userId: payload.userId,
            sessionId: payload.sessionId,
            role: payload.role,
          };

          const userRuntime: IUserApp = {
            db,
            tenantId: payload.tenantId,
            nowDatetime,
            session,
          };

          return { userRuntime };
        })
        .macro("RoleGuard", MacroRoleGuard)
        .macro("PlanGuard", MacroPlanGuard)
        .use(PluginAudit);
  }
}

export default new Context();
