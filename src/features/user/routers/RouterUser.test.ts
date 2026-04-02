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
        phone: "05551234567",
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
        phone: "05551234567",
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
        createdAt: expect.any(Date),
        name: "Test User",
        role: EUserRole.SYSTEM,
        avatarId: null,
      },
      {
        createdAt: expect.any(Date),
        name: "List User",
        role: EUserRole.USER,
        avatarId: null,
      },
    ]);
  });

  it("Get user by id", async () => {
    const headers = await testHeaders();

    const user = await api.user.post(
      {
        name: "Get User Test",
        phone: "05551234567",
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
        phone: "05551234567",
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
});
