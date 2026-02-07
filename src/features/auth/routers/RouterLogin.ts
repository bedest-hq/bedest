import { Elysia, t } from "elysia";
import {
  EXAMPLE_EMAIL,
  EXAMPLE_USER_PASSWORD,
} from "../../../common/constants";
import ServiceAuth from "../services/ServiceAuth";
import ServiceSession from "@/features/session/services/ServiceSession";
import Context from "@/app/Context";

export const RouterLogin = new Elysia({ prefix: "/auth", tags: ["Auth"] }).use(
  Context.App(),
);

RouterLogin.post(
  "/login",
  async ({ body, nowDatetime, db, refreshJwt, accessJwt, set }) => {
    const c = { nowDatetime, db };
    const result = await ServiceAuth.login(c, {
      email: body.email ?? EXAMPLE_EMAIL,
      password: body.password ?? EXAMPLE_USER_PASSWORD,
    });

    const payload = {
      userId: result.userId,
      name: result.name,
      role: result.role,
    };

    const refreshToken = await refreshJwt.sign(payload);
    const accessToken = await accessJwt.sign(payload);

    await ServiceSession.create(c, {
      userId: result.userId,
    });

    set.cookie = {
      refreshToken: {
        value: refreshToken,
        path: "/",
        httpOnly: true,
        secure: Bun.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60,
        sameSite: "lax",
      },
      accessToken: {
        value: accessToken,
        path: "/",
        httpOnly: true,
        secure: Bun.env.NODE_ENV === "production",
        maxAge: 15 * 60,
        sameSite: "lax",
      },
    };

    return { name: result.name, role: result.role };
  },
  {
    body: t.Object({
      email: t.String({
        format: "email",
        ...(Bun.env.NODE_ENV === "development" && {
          default: EXAMPLE_EMAIL,
        }),
      }),
      password: t.String({
        minLength: 6,
        ...(Bun.env.NODE_ENV === "development" && {
          default: EXAMPLE_USER_PASSWORD,
        }),
      }),
    }),
  },
);
