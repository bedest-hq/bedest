import { Elysia, t } from "elysia";
import ServiceAuth from "../services/ServiceAuth";
import Context from "@/app/Context";
import { UtilRouter } from "@/common/utils/UtilRouter";

export const RouterLogout = new Elysia({ prefix: "/auth", tags: ["Auth"] })
  .use(Context.User())
  .post(
    "/logout",
    async ({ userRuntime, cookie }) => {
      await ServiceAuth.logout(userRuntime);
      cookie.accessToken.remove();
      cookie.refreshToken.remove();
      return UtilRouter.defResponse({ success: true });
    },
    {
      response: UtilRouter.defSchema(t.Object({ success: t.Boolean() })),
    },
  );
