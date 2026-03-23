import { Elysia, t } from "elysia";
import {
  EXAMPLE_EMAIL,
  EXAMPLE_USER_PASSWORD,
} from "../../../common/constants";
import ServiceAuth from "../services/ServiceAuth";
import ServiceSession from "@/features/session/services/ServiceSession";
import Context from "@/app/Context";
import { VString } from "@/common/validations/VString";
import { SUserRole } from "@f/user/validations/SUserRole";
import { UtilAuth } from "../utils/UtilAuth";
import EnvManager from "@/infrastructure/env/EnvManager";
import { rateLimit } from "elysia-rate-limit";

const env = EnvManager.get();
export const RouterLogin = new Elysia({ prefix: "/auth", tags: ["Auth"] })
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
      const c = { nowDatetime, db };
      const result = await ServiceAuth.login(c, {
        email: body.email ?? EXAMPLE_EMAIL,
        password: body.password ?? EXAMPLE_USER_PASSWORD,
      });
      const session = await ServiceSession.create(c, {
        tenantId: result.tenantId,
        userId: result.userId,
      });

      const payload = {
        tenantId: result.tenantId,
        userId: result.userId,
        sessionId: session.id,
        role: result.role,
      };

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

      return { name: result.name, role: result.role };
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
      response: t.Object({ name: VString, role: SUserRole }),
    },
  );
