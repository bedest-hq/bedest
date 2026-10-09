import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import {
  testHeaders,
  createTestUser,
  createForeignTenant,
  test_user,
  test_tenant,
  test_db,
} from "@/common/tests/TestManager.test";
import { RouterNotification } from "./RouterNotification";
import { RouterAuth } from "@f/auth/routers/RouterAuth";
import { SNotification } from "../schemas/SNotification";
import ServiceNotification from "../services/ServiceNotification";
import { EUserRole } from "@f/user/enums/EUserRole";
import { ITenantUserApp } from "bedest-core";

const api = treaty(RouterNotification);

describe("RouterNotification", () => {
  let wsUrl: string;
  let serverApp: ReturnType<typeof createApp>;
  let stopApp: () => void;

  const createApp = () =>
    new Elysia().use(RouterNotification).use(RouterAuth).listen(0);

  beforeAll(() => {
    const app = createApp();
    serverApp = app;
    wsUrl = `ws://localhost:${app.server?.port}/notifications/live`;
    stopApp = () => app.stop();
  });

  afterAll(() => {
    if (stopApp) {
      stopApp();
    }
  });

  it("Get empty notifications list initially", async () => {
    const headers = await testHeaders();

    const res = await api.notifications.get({
      headers,
      query: { page: 1, limit: 10 },
    });

    expect(res.status).toBe(200);
    expect(res.data?.data).toHaveLength(0);
    expect(res.data?.meta.total).toBe(0);
  });

  it("Get list of seeded notifications", async () => {
    const headers = await testHeaders();

    await test_db.insert(SNotification).values({
      tenantId: test_tenant.id,
      userId: test_user.id,
      event: "test.event",
      payload: { message: "Hello World" },
    });

    const res = await api.notifications.get({
      headers,
      query: { page: 1, limit: 10 },
    });

    expect(res.status).toBe(200);
    expect(res.data?.data.length).toBeGreaterThanOrEqual(1);
    expect(res.data?.data[0].event).toBe("test.event");
    expect(res.data?.data[0].isRead).toBe(false);
  });

  it("Filter unread notifications", async () => {
    const headers = await testHeaders();

    await test_db.insert(SNotification).values([
      {
        tenantId: test_tenant.id,
        userId: test_user.id,
        event: "unread.event",
        isRead: false,
      },
      {
        tenantId: test_tenant.id,
        userId: test_user.id,
        event: "read.event",
        isRead: true,
        readAt: new Date(),
      },
    ]);

    const res = await api.notifications.get({
      headers,
      query: { page: 1, limit: 10, unreadOnly: true },
    });

    expect(res.status).toBe(200);
    expect(res.data?.data.every((n) => !n.isRead)).toBe(true);
  });

  it("Mark a notification as read", async () => {
    const headers = await testHeaders();

    const [notif] = await test_db
      .insert(SNotification)
      .values({
        tenantId: test_tenant.id,
        userId: test_user.id,
        event: "mark.read.test",
      })
      .returning();

    const patchRes = await api
      .notifications({ id: notif.id })
      .read.patch({}, { headers });

    expect(patchRes.status).toBe(200);
    expect(patchRes.data).toStrictEqual({ success: true });

    const checkRes = await api.notifications.get({
      headers,
      query: { page: 1, limit: 10 },
    });

    const updatedNotif = checkRes.data?.data.find((n) => n.id === notif.id);
    expect(updatedNotif?.isRead).toBe(true);
    expect(updatedNotif?.readAt).not.toBeNull();
  });

  it("Mark all notifications as read", async () => {
    const headers = await testHeaders();

    await test_db.insert(SNotification).values([
      { tenantId: test_tenant.id, userId: test_user.id, event: "bulk.1" },
      { tenantId: test_tenant.id, userId: test_user.id, event: "bulk.2" },
    ]);

    const patchRes = await api.notifications["read-all"].patch({}, { headers });
    expect(patchRes.status).toBe(200);
    expect(patchRes.data).toStrictEqual({ success: true });

    const checkRes = await api.notifications.get({
      headers,
      query: { page: 1, limit: 10, unreadOnly: true },
    });
    expect(checkRes.data?.meta.total).toBe(0);
  });

  it("Connect to WebSocket and respond to ping", async () => {
    const headers = await testHeaders();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS timeout")), 2000);

      const ws = new WebSocket(wsUrl, {
        // @ts-expect-error - Bun WebSocket accepts headers here
        headers,
      });

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.event === "connected") {
          ws.send(JSON.stringify({ event: "ping" }));
        } else if (msg.event === "pong") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };
    });
  });

  it("Unauthenticated WebSocket connection is rejected", async () => {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WS rejection timeout")),
        2000,
      );

      const ws = new WebSocket(wsUrl);

      ws.onclose = (e) => {
        clearTimeout(timeout);
        expect(e.code).not.toBe(1000);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  });

  it("WebSocket disconnection on logout (code 1008)", async () => {
    const headers = await testHeaders();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WS logout disconnection timeout")),
        3000,
      );

      const ws = new WebSocket(wsUrl, {
        // @ts-expect-error - Bun WebSocket accepts headers here
        headers,
      });

      let receivedTerminated = false;

      ws.onmessage = async (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.event === "connected") {
          const authApi = treaty(serverApp);
          const logoutRes = await authApi.auth.logout.post({}, { headers });
          expect(logoutRes.status).toBe(200);
        } else if (msg.event === "session_terminated") {
          receivedTerminated = true;
        }
      };

      ws.onclose = (e) => {
        clearTimeout(timeout);
        expect(e.code).toBe(1008);
        expect(receivedTerminated).toBe(true);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Unexpected WebSocket error"));
      };
    });
  });

  it("Broadcast notification inbox visibility and per-user read tracking across tenant members", async () => {
    // 1. Create two users in test_tenant and one foreign tenant user
    const userA = await createTestUser(EUserRole.USER, test_tenant);
    const userB = await createTestUser(EUserRole.USER, test_tenant);
    const foreign = await createForeignTenant(EUserRole.USER);

    // 2. Admin sends broadcast to test_tenant
    const adminContext: ITenantUserApp = {
      db: test_db as unknown as ITenantUserApp["db"],
      nowDatetime: new Date(),
      tenantId: test_tenant.id,
      session: {
        userId: test_user.id,
        sessionId: "admin-session",
        role: EUserRole.ADMIN,
        isSuperUser: false,
      },
    };

    await ServiceNotification.sendToTenant(adminContext, "maintenance_alert", {
      text: "System maintenance tonight",
    });

    // 3. User A and User B see the broadcast notification
    const resA = await api.notifications.get({
      headers: userA.headers,
      query: { limit: 10, page: 1 },
    });
    expect(resA.status).toBe(200);
    const notifA = resA.data?.data.find((n) => n.event === "maintenance_alert");
    expect(notifA).toBeDefined();
    expect(notifA?.isRead).toBe(false);

    const resB = await api.notifications.get({
      headers: userB.headers,
      query: { limit: 10, page: 1 },
    });
    expect(resB.status).toBe(200);
    const notifB = resB.data?.data.find((n) => n.event === "maintenance_alert");
    expect(notifB).toBeDefined();
    expect(notifB?.isRead).toBe(false);

    // 4. Foreign tenant user does NOT see the broadcast notification
    const resForeign = await api.notifications.get({
      headers: foreign.headers,
      query: { limit: 10, page: 1 },
    });
    expect(resForeign.status).toBe(200);
    const notifForeign = resForeign.data?.data.find(
      (n) => n.event === "maintenance_alert",
    );
    expect(notifForeign).toBeUndefined();

    // 5. User A marks the broadcast as read
    const markRes = await api
      .notifications({ id: notifA!.id })
      .read.patch({}, { headers: userA.headers });
    expect(markRes.status).toBe(200);

    // 6. User A now sees it as read
    const checkA = await api.notifications.get({
      headers: userA.headers,
      query: { limit: 10, page: 1 },
    });
    const updatedA = checkA.data?.data.find(
      (n) => n.event === "maintenance_alert",
    );
    expect(updatedA?.isRead).toBe(true);

    // 7. User B STILL sees it as unread
    const checkB = await api.notifications.get({
      headers: userB.headers,
      query: { limit: 10, page: 1 },
    });
    const updatedB = checkB.data?.data.find(
      (n) => n.event === "maintenance_alert",
    );
    expect(updatedB?.isRead).toBe(false);

    // User B with unreadOnly: true still finds it
    const checkBUnread = await api.notifications.get({
      headers: userB.headers,
      query: { limit: 10, page: 1, unreadOnly: true },
    });
    expect(
      checkBUnread.data?.data.some((n) => n.event === "maintenance_alert"),
    ).toBe(true);

    // 8. User B marks all read
    const markAllRes = await api.notifications["read-all"].patch(
      {},
      { headers: userB.headers },
    );
    expect(markAllRes.status).toBe(200);

    const checkBAfterReadAll = await api.notifications.get({
      headers: userB.headers,
      query: { limit: 10, page: 1 },
    });
    const finalB = checkBAfterReadAll.data?.data.find(
      (n) => n.event === "maintenance_alert",
    );
    expect(finalB?.isRead).toBe(true);
  });
});
