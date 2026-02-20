import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { RouterLogin } from "./RouterLogin";
import { RouterLogout } from "./RouterLogout";
import { RouterRefresh } from "./RouterRefresh";
import { testHeaders, test_user } from "@/common/tests/TestManager.test";

const loginApi = treaty(RouterLogin);
const logoutApi = treaty(RouterLogout);
const refreshApi = treaty(RouterRefresh);

describe("RouterAuth", () => {
  it("Login", async () => {
    const res = await loginApi.auth.login.post({
      email: test_user.email,
      password: "test_password",
    });

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("name", test_user.name);
    expect(res.data).toHaveProperty("role", test_user.role);

    const cookies = res.response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);

    const refreshTokenHeader = cookies.find((c) =>
      c.startsWith("refreshToken="),
    );
    expect(refreshTokenHeader).toBeDefined();
  });

  it("Fail to login with wrong credentials", async () => {
    const res = await loginApi.auth.login.post({
      email: test_user.email,
      password: "wrong_password_123",
    });

    expect(res.status).not.toBe(200);
  });

  it("Refresh token", async () => {
    const loginRes = await loginApi.auth.login.post({
      email: test_user.email,
      password: "test_password",
    });
    const cookies = loginRes.response.headers.getSetCookie();
    const res = await refreshApi.auth.refresh.post(null, {
      headers: {
        Cookie: cookies,
      },
    });

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("accessToken");
    expect(typeof res.data?.accessToken).toBe("string");
  });

  it("Fail to refresh without token", async () => {
    const res = await refreshApi.auth.refresh.post(null, {
      headers: {
        Cookie: "",
      },
    });

    expect(res.status).toBe(401);
  });

  it("Logout successfully", async () => {
    const headers = await testHeaders();

    const res = await logoutApi.auth.logout.post(null, {
      headers,
    });

    expect(res.status).toBe(200);

    const cookies = res.response.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("accessToken="))).toBe(true);
  });
});
