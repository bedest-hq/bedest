import { jwt } from "@elysiajs/jwt";
import Elysia from "elysia";
import { t } from "elysia";
import { IUserApp } from "../common/interfaces/IContextApp";
import { ISession } from "../features/session/interfaces/ISession";
import { EUserRole } from "../features/user/enums/EUserRole";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import DbManager from "@/infrastructure/db/DbManager";

class Context {
  private SECRET_KEY = Bun.env.SECRET_KEY || "secret-key";
  private REFRESH_KEY = Bun.env.REFRESH_KEY || "refresh-key";

  private refreshPlugin = jwt({
    name: "refreshJwt",
    secret: this.REFRESH_KEY,
    exp: "7d",
    iat: true,
  });

  private accessPlugin = jwt({
    name: "accessJwt",
    secret: this.SECRET_KEY,
    exp: "15m",
    iat: true,
  });

  private async validateAccessToken(
    accessJwt: {
      verify: (token: string) => Promise<Record<string, unknown> | false>;
    },
    token: string | undefined,
  ): Promise<{ userId: string; agencyId: string; role: string }> {
    if (!token) {
      throw ErrorHandler.unauthorized("Access token missing");
    }

    const payload = await accessJwt.verify(token);

    if (!payload) {
      throw ErrorHandler.unauthorized("Unauthorized");
    }

    const { userId, agencyId, role } = payload;

    if (!userId || !agencyId || !role) {
      throw ErrorHandler.unauthorized("Invalid token payload");
    }

    return {
      userId: String(userId),
      agencyId: String(agencyId),
      role: String(role),
    };
  }

  private parseRole(role: string): EUserRole {
    switch (role) {
      case EUserRole.ADMIN:
        return EUserRole.ADMIN;
      case EUserRole.USER:
        return EUserRole.USER;
      default:
        return EUserRole.GUEST;
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
          const payload = await this.validateAccessToken(accessJwt, token);
          const role = this.parseRole(payload.role);

          const session: ISession = {
            userId: payload.userId,
            role,
          };

          const userRuntime: IUserApp = {
            db,
            nowDatetime,
            session,
          };

          return { userRuntime };
        });
  }
}

export default new Context();
