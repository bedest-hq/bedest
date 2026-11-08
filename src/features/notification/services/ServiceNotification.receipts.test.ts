import { describe, it, expect } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  createTestUser,
  test_db,
  test_tenant,
} from "@/common/tests/TestManager.test";
import DbManager from "@/infrastructure/database/DbManager";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SNotification, SNotificationRead } from "../schemas/SNotification";
import ServiceNotification from "./ServiceNotification";

const broadcast = async () => {
  const [row] = await test_db
    .insert(SNotification)
    .values({ tenantId: test_tenant.id, isBroadcast: true, event: "news" })
    .returning({ id: SNotification.id });
  return row.id;
};

const ctxFor = (userId: string) => ({
  db: DbManager.get(),
  nowDatetime: new Date(),
  tenantId: test_tenant.id,
  session: {
    userId,
    sessionId: crypto.randomUUID(),
    role: EUserRole.USER,
    isSuperUser: false,
  },
});

const receipts = (notificationId: string, userId: string) =>
  test_db
    .select()
    .from(SNotificationRead)
    .where(
      and(
        eq(SNotificationRead.notificationId, notificationId),
        eq(SNotificationRead.userId, userId),
      ),
    );

describe("BUG-05: notification read receipts", () => {
  it("[BUG-05] the database refuses a second receipt for the same notification and user", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const id = await broadcast();
    const values = {
      tenantId: test_tenant.id,
      notificationId: id,
      userId: user.id,
      readAt: new Date(),
    };
    await test_db.insert(SNotificationRead).values(values);
    const second = await test_db
      .insert(SNotificationRead)
      .values(values)
      .then(
        () => "inserted",
        (err: unknown) => String(err),
      );
    expect(second).not.toBe("inserted");
  });

  it("[BUG-05] concurrent markRead/markAllRead calls leave exactly one receipt and the list total is unaffected", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const id = await broadcast();
    const c = ctxFor(user.id);

    await Promise.all([
      ...Array.from({ length: 5 }, () => ServiceNotification.markRead(c, id)),
      ServiceNotification.markAllRead(c),
      ServiceNotification.markAllRead(c),
    ]);

    expect(await receipts(id, user.id)).toHaveLength(1);
    const list = await ServiceNotification.getAll(c, { limit: 20, page: 1 });
    expect(list.meta.total).toBe(1);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.isRead).toBe(true);
  });
});
