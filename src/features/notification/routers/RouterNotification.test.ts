import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import {
  testHeaders,
  test_user,
  test_tenant,
  test_db,
} from "@/common/tests/TestManager.test";
import { RouterNotification } from "./RouterNotification";
import { SNotification } from "../schemas/SNotification";

const api = treaty(RouterNotification);

describe("RouterNotification", () => {
  let wsUrl: string;
  let stopApp: () => void;

  beforeAll(() => {
    const app = new Elysia().use(RouterNotification).listen(0);
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
});
