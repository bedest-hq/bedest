import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { createTestUser } from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import WsManager, { IWsClient } from "@/infrastructure/websocket/WsManager";
import { EUserRole } from "@f/user/enums/EUserRole";
import { RouterAuth } from "./RouterAuth";

const app = new Elysia().use(ErrorHandler).use(RouterAuth);

const login = async (email: string) => {
  const res = await app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "test_password" }),
    }),
  );
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const token =
    cookie
      .split("; ")
      .find((c) => c.startsWith("accessToken="))
      ?.slice("accessToken=".length) ?? "";
  const { sessionId } = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { sessionId: string };
  return { cookie, sessionId };
};

const socket = () => {
  const state = { closed: false };
  const ws: IWsClient = {
    send: () => {},
    close: () => {
      state.closed = true;
    },
  };
  return { ws, state };
};

describe("BUG-06: logout only disconnects its own session", () => {
  it("[BUG-06] logging out one device closes only that device's socket", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const laptop = await login(user.email);
    const phone = await login(user.email);
    const laptopSocket = socket();
    const phoneSocket = socket();
    WsManager.registerClient(user.id, laptopSocket.ws, laptop.sessionId);
    WsManager.registerClient(user.id, phoneSocket.ws, phone.sessionId);

    const res = await app.handle(
      new Request("http://localhost/auth/logout", {
        method: "POST",
        headers: { Cookie: laptop.cookie },
      }),
    );
    expect(res.status).toBe(200);

    expect(laptopSocket.state.closed).toBe(true);
    expect(phoneSocket.state.closed).toBe(false);
    WsManager.unregisterClient(user.id, phoneSocket.ws, phone.sessionId);
  });
});
