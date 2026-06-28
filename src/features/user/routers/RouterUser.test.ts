import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { test_user, testHeaders } from "@/common/tests/TestManager.test";
import { RouterUser } from "./RouterUser";
import { EUserRole } from "../enums/EUserRole";

const api = treaty(RouterUser);

describe("RouterUser", () => {
  it("Create a new user", async () => {
    const headers = await testHeaders();

    const res = await api.user.post(
      {
        name: "New User",
        email: "newuser@example.com",
        role: EUserRole.USER,
        password: "securepassword",
      },
      { headers },
    );

    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("id");
  });

  it("Get all users", async () => {
    const headers = await testHeaders();

    await api.user.post(
      {
        name: "List User",
        email: "listuser@example.com",
        role: EUserRole.USER,
        password: "securepassword",
      },
      { headers },
    );

    const res = await api.user.get({
      headers,
      query: { page: 1, limit: 100 },
    });

    expect(res.status).toBe(200);
    expect(res.data!.data).toStrictEqual([
      {
        id: expect.any(String),
        tenantId: expect.any(String),
        createdAt: expect.any(Date),
        name: "List User",
        role: EUserRole.USER,
        avatarId: null,
      },
      {
        id: expect.any(String),
        tenantId: expect.any(String),
        createdAt: expect.any(Date),
        name: "Test User",
        role: EUserRole.SYSTEM,
        avatarId: null,
      },
    ]);
  });

  it("Get user by id", async () => {
    const headers = await testHeaders();

    const user = await api.user.post(
      {
        name: "Get User Test",
        email: "getuser@example.com",
        role: EUserRole.ADMIN,
        password: "securepassword",
      },
      { headers },
    );

    const res = await api.user({ id: user.data!.id }).get({
      headers,
    });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      createdAt: expect.any(Date),
      name: "Get User Test",
      role: EUserRole.ADMIN,
      avatarId: null,
    });
  });

  it("Get Self", async () => {
    const headers = await testHeaders();

    const res = await api.user.self.get({ headers });

    expect(res.status).toBe(200);
    expect(res.data).toStrictEqual({
      name: "Test User",
      email: "text@example.com",
      role: EUserRole.SYSTEM,
      avatarId: null,
      createdAt: expect.any(Date),
    });
  });

  it("Update user", async () => {
    const headers = await testHeaders();

    const res = await api.user({ id: test_user.id }).put(
      {
        name: "Updated User Name",
      },
      { headers },
    );

    expect(res.status).toBe(200);

    const updatedRes = await api.user({ id: test_user.id }).get({
      headers,
    });

    expect(updatedRes.status).toBe(200);
    expect(updatedRes.data).toStrictEqual({
      createdAt: expect.any(Date),
      name: "Updated User Name",
      role: EUserRole.SYSTEM,
      avatarId: null,
    });
  });

  it("Delete user", async () => {
    const headers = await testHeaders();

    const user = await api.user.post(
      {
        name: "Delete User",
        email: "deleteuser@example.com",
        role: EUserRole.USER,
        password: "securepassword",
      },
      { headers },
    );

    const res = await api.user({ id: user.data!.id }).delete({}, { headers });

    expect(res.status).toBe(200);

    const checkRes = await api.user({ id: user.data!.id }).get({
      headers,
    });

    expect(checkRes.status).toBe(404);
  });

  it("Return 404 for non-existent user", async () => {
    const headers = await testHeaders();
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const res = await api.user({ id: fakeId }).get({
      headers,
    });

    expect(res.status).toBe(404);
  });

  it("Guest access should be denied", async () => {
    const res = await api.user.self.get();

    expect(res.status).toBe(401);
  });

  it("Non-privileged user can change password with correct currentPassword", async () => {
    const adminHeaders = await testHeaders();

    const createRes = await api.user.post(
      {
        name: "Password Test User",
        email: "pwtest@example.com",
        role: EUserRole.USER,
        password: "oldpassword1",
      },
      { headers: adminHeaders },
    );
    expect(createRes.status).toBe(200);
    const userId = createRes.data!.id;

    const { RouterAuth } = await import("@f/auth/routers/RouterAuth");
    const authApi = treaty(RouterAuth);

    const loginRes = await authApi.auth.login.post({
      email: "pwtest@example.com",
      password: "oldpassword1",
    });
    expect(loginRes.status).toBe(200);

    const cookies = loginRes.response.headers.getSetCookie();
    const userHeaders = { Cookie: cookies.join("; ") };

    const changeRes = await api.user({ id: userId }).put(
      {
        currentPassword: "oldpassword1",
        password: "newpassword1",
      },
      { headers: userHeaders },
    );

    expect(changeRes.status).toBe(200);
    expect(changeRes.data).toStrictEqual({ success: true });
  });

  it("Non-privileged user is rejected when currentPassword is wrong", async () => {
    const adminHeaders = await testHeaders();

    const createRes = await api.user.post(
      {
        name: "Bad PW User",
        email: "badpw@example.com",
        role: EUserRole.USER,
        password: "correctpassword",
      },
      { headers: adminHeaders },
    );
    expect(createRes.status).toBe(200);
    const userId = createRes.data!.id;

    const { RouterAuth } = await import("@f/auth/routers/RouterAuth");
    const authApi = treaty(RouterAuth);

    const loginRes = await authApi.auth.login.post({
      email: "badpw@example.com",
      password: "correctpassword",
    });
    const cookies = loginRes.response.headers.getSetCookie();
    const userHeaders = { Cookie: cookies.join("; ") };

    const changeRes = await api.user({ id: userId }).put(
      {
        currentPassword: "wrongpassword",
        password: "newpassword1",
      },
      { headers: userHeaders },
    );

    expect(changeRes.status).toBe(401);
  });

  it("Non-privileged user is rejected when currentPassword is omitted", async () => {
    const adminHeaders = await testHeaders();

    const createRes = await api.user.post(
      {
        name: "No Current PW User",
        email: "nocurrentpw@example.com",
        role: EUserRole.USER,
        password: "somepassword1",
      },
      { headers: adminHeaders },
    );
    expect(createRes.status).toBe(200);
    const userId = createRes.data!.id;

    const { RouterAuth } = await import("@f/auth/routers/RouterAuth");
    const authApi = treaty(RouterAuth);

    const loginRes = await authApi.auth.login.post({
      email: "nocurrentpw@example.com",
      password: "somepassword1",
    });
    const cookies = loginRes.response.headers.getSetCookie();
    const userHeaders = { Cookie: cookies.join("; ") };

    const changeRes = await api.user({ id: userId }).put(
      {
        password: "newpassword1",
      },
      { headers: userHeaders },
    );

    expect(changeRes.status).toBe(400);
  });

  it("SYSTEM user can change any password without currentPassword", async () => {
    const adminHeaders = await testHeaders();

    const createRes = await api.user.post(
      {
        name: "Target User",
        email: "target@example.com",
        role: EUserRole.USER,
        password: "originalpassword",
      },
      { headers: adminHeaders },
    );
    expect(createRes.status).toBe(200);
    const userId = createRes.data!.id;

    const changeRes = await api.user({ id: userId }).put(
      {
        password: "forcedresetpassword",
      },
      { headers: adminHeaders },
    );

    expect(changeRes.status).toBe(200);
    expect(changeRes.data).toStrictEqual({ success: true });
  });
});
