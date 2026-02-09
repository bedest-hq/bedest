import Context from "@/app/Context";
import ServiceSession from "@/features/session/services/ServiceSession";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { Elysia } from "elysia";

export const RouterRefresh = new Elysia({
  prefix: "/auth",
  tags: ["Auth"],
}).use(Context.App());

RouterRefresh.post(
  "/refresh",
  async ({ accessJwt, refreshJwt, cookie, nowDatetime, db }) => {
    const refreshToken = cookie.refreshToken.value;

    if (!refreshToken) {
      throw ErrorHandler.unauthorized("Refresh token missing");
    }

    const payload = await refreshJwt.verify(refreshToken as string);

    if (!payload) {
      throw ErrorHandler.unauthorized("Invalid refresh token");
    }

    const session = await ServiceSession.isValid(
      { db, nowDatetime },
      payload.userId as string,
      payload.sessionId as string,
    );

    if (!session.isActive) {
      throw ErrorHandler.unauthorized("Session expired or revoked");
    }

    const newAccessToken = await accessJwt.sign({
      sessionId: payload.sessionId,
      userId: payload.userId,
      role: session.user.role,
    });

    return { accessToken: newAccessToken };
  },
);
