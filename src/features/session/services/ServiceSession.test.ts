import { describe, it, expect } from "bun:test";
import ServiceSession from "./ServiceSession";
import { test_db, test_user, test_tenant } from "@/common/tests/TestManager.test";
import { IApp } from "bedest-core";

describe("ServiceSession", () => {
  const context: IApp = {
    db: test_db as unknown as IApp["db"],
    nowDatetime: new Date(),
  };

  it("Create session with default 7-day TTL and verify validity", async () => {
    const session = await ServiceSession.create(context, {
      tenantId: test_tenant.id,
      userId: test_user.id,
    });

    expect(session?.id).toBeDefined();

    const isValid = await ServiceSession.isValid(context, session!.id);
    expect(isValid).toBe(true);
  });

  it("Expired session is invalid and cleaned up by cleanExpiredSessions", async () => {
    // 1. Create an expired session (expires in the past)
    const expiredPast = new Date(Date.now() - 1000 * 60 * 60);
    const expiredSession = await ServiceSession.create(context, {
      tenantId: test_tenant.id,
      userId: test_user.id,
      expiresAt: expiredPast,
    });

    // 2. Create a valid session (expires in future)
    const validFuture = new Date(Date.now() + 1000 * 60 * 60 * 24);
    const validSession = await ServiceSession.create(context, {
      tenantId: test_tenant.id,
      userId: test_user.id,
      expiresAt: validFuture,
    });

    // 3. isValid returns false for expired session, true for valid session
    const isExpiredValid = await ServiceSession.isValid(context, expiredSession!.id);
    expect(isExpiredValid).toBe(false);

    const isFutureValid = await ServiceSession.isValid(context, validSession!.id);
    expect(isFutureValid).toBe(true);

    // 4. Run cleanExpiredSessions
    const cleanResult = await ServiceSession.cleanExpiredSessions(context);
    expect(cleanResult.count).toBeGreaterThanOrEqual(1);

    // 5. Expired session no longer exists in DB
    const isExpiredStillValid = await ServiceSession.isValid(context, expiredSession!.id);
    expect(isExpiredStillValid).toBe(false);

    // 6. Valid session remains valid
    const isFutureStillValid = await ServiceSession.isValid(context, validSession!.id);
    expect(isFutureStillValid).toBe(true);
  });
});
