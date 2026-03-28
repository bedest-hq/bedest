import { jwt } from "@elysiajs/jwt";
import Elysia from "elysia";
import { t } from "elysia";
import { IUserApp } from "../common/interfaces/IContextApp";
import { ISession } from "../features/session/interfaces/ISession";
import { EUserRole } from "../features/user/enums/EUserRole";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import DbManager from "@/infrastructure/database/DbManager";
import EnvManager from "@/infrastructure/env/EnvManager";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import ServiceSystem from "@f/system/services/ServiceSystem";
import ServiceTenant from "@f/tenant/services/ServiceTenant";
import { UtilAuth } from "@f/auth/utils/UtilAuth";

class Context {
  private env = EnvManager.get();

  private refreshPlugin = jwt({
    name: "refreshJwt",
    secret: this.env.REFRESH_KEY!,
    exp: "7d",
    iat: true,
  });

  private accessPlugin = jwt({
    name: "accessJwt",
    secret: this.env.SECRET_KEY!,
    exp: "15m",
    iat: true,
  });

  private parseRole(role: string): EUserRole {
    switch (role) {
      case EUserRole.SYSTEM:
        return EUserRole.SYSTEM;
      case EUserRole.ADMIN:
        return EUserRole.ADMIN;
      case EUserRole.USER:
        return EUserRole.USER;
      default:
        throw ErrorHandler.forbidden("Invalid or unrecognized user role.");
    }
  }

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
          const role = this.parseRole(payload.role);

          if (ServiceSystem.getMaintenance() && role !== EUserRole.SYSTEM) {
            throw ErrorHandler.maintenance();
          }

          const session: ISession = {
            userId: payload.userId,
            sessionId: payload.sessionId,
            role,
          };

          const userRuntime: IUserApp = {
            db,
            tenantId: payload.tenantId,
            nowDatetime,
            session,
          };

          return { userRuntime };
        })
        .macro("RoleGuard", (roles: EUserRole[]) => ({
          beforeHandle({ userRuntime }) {
            if (!userRuntime) {
              throw ErrorHandler.unauthorized("Authentication required.");
            }
            if (!roles.includes(userRuntime.session.role)) {
              throw ErrorHandler.forbidden(
                "You do not have permission to access this resource.",
              );
            }
          },
        }))
        .macro("PlanGuard", (plans: ETenantPlan[]) => ({
          async beforeHandle({ userRuntime }) {
            if (!userRuntime) {
              throw ErrorHandler.unauthorized("Authentication required.");
            }

            const tenant = await ServiceTenant.checkPlan(
              { db: userRuntime.db, nowDatetime: userRuntime.nowDatetime },
              userRuntime.tenantId,
            );

            if (!tenant) {
              throw ErrorHandler.notFound("Tenant not found.");
            }

            if (tenant.planEnd < userRuntime.nowDatetime) {
              throw ErrorHandler.planNotActive(
                "Your plan has expired. Please renew to continue.",
              );
            }

            if (!plans.includes(tenant.plan)) {
              throw ErrorHandler.planNotEnabled(
                "Your current plan does not support this feature. Please upgrade.",
              );
            }
          },
        }));
  }
}

export default new Context();
