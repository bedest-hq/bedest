import { Elysia } from "elysia";
import ServiceAuth from "../services/ServiceAuth";
import Context from "@/app/Context";

export const RouterLogout = new Elysia({ prefix: "/auth", tags: ["Auth"] }).use(
  Context.User(),
);

RouterLogout.post(
  "/logout",
  async ({ userRuntime, cookie }) => {
    const c = userRuntime;
    await ServiceAuth.logout(c);
    cookie.accessToken.remove();
    cookie.refreshToken.remove();
    return;
  },
  {
    response: {},
  },
);
