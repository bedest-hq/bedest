import Context from "@/app/Context";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { Elysia } from "elysia";

export const RouterRefresh = new Elysia({
  prefix: "/auth",
  tags: ["Auth"],
}).use(Context.App());

RouterRefresh.post(
  "/auth/refresh",
  async ({ accessJwt, refreshJwt, cookie, nowDatetime, db }) => {
    const refreshToken = cookie.refreshToken.value;
    const payload = await refreshJwt.verify(refreshToken as string);

    if (!refreshToken) {
      throw ErrorHandler.unauthorized("Refresh token missing");
    }

    if (!payload) {
      throw ErrorHandler.unauthorized("Invalid refresh token");
    }

    await ServiceSession.isValid({ db, nowDatetime }, payload.userId as string);

    const newAccessToken = await accessJwt.sign({
      userId: payload.userId,
      role: payload.role,
    });

    return { accessToken: newAccessToken };
  },
);
