import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import { and, eq, sql } from "drizzle-orm";
import Context from "@/app/Context";
import { UtilPlanGuard } from "@f/tenant/utils/UtilPlanGuard";
import { createRouter } from "@/app/Router";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterBilling } from "./RouterBilling";
import {
  test_db,
  test_env,
  test_tenant,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { STenant } from "@/features/tenant/schemas/STenant";
import { SSystemLog } from "@/features/system/schemas/SSystemLog";
import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";

const SECRET = test_env.BILLING_WEBHOOK_SECRET ?? "";
const nowSec = () => Math.floor(Date.now() / 1000);

/** Builds a Stripe-style `Stripe-Signature` header over the exact bytes. */
const sign = (raw: string, secret = SECRET, t = nowSec()) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;

const event = (
  type: string,
  object: Record<string, unknown>,
  id = `evt_${crypto.randomUUID()}`,
) =>
  JSON.stringify({
    id,
    object: "event",
    api_version: "2024-06-20",
    type,
    data: { object },
  });

const app = new Elysia().use(ErrorHandler).use(RouterBilling);

const send = (raw: string, signature?: string) =>
  app.handle(
    new Request("http://localhost/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "stripe-signature": signature } : {}),
      },
      body: raw,
    }),
  );

const tenantRow = async () => {
  const [row] = await test_db
    .select()
    .from(STenant)
    .where(eq(STenant.id, test_tenant.id));
  return row;
};

const auditRows = (action: string) =>
  test_db
    .select()
    .from(SSystemLog)
    .where(
      and(
        eq(SSystemLog.tenantId, test_tenant.id),
        eq(SSystemLog.action, action),
      ),
    );

const setPlan = (plan: ETenantPlan) =>
  test_db
    .update(STenant)
    .set({
      plan,
      planStart: new Date(),
      planEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .where(eq(STenant.id, test_tenant.id));

const checkoutCompleted = (plan?: string) => ({
  client_reference_id: test_tenant.id,
  customer: "cus_stripe_123",
  subscription: "sub_stripe_abc",
  current_period_start: nowSec(),
  current_period_end: nowSec() + 60 * 24 * 60 * 60,
  metadata: { tenantId: test_tenant.id, ...(plan ? { plan } : {}) },
});

describe("SEC-05: billing webhook authenticity", () => {
  it("[SEC-05] no signature → 401", async () => {
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    expect((await send(raw)).status).toBe(401);
    expect((await tenantRow()).plan).toBe(ETenantPlan.PROFESSIONAL);
  });

  it("[SEC-05] the raw secret used as the signature header → 401", async () => {
    await setPlan(ETenantPlan.BASIC);
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    expect((await send(raw, SECRET)).status).toBe(401);
    expect((await tenantRow()).plan).toBe(ETenantPlan.BASIC);
  });

  it("[SEC-05] a plain HMAC of the body (legacy scheme) → 401", async () => {
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    const legacy = createHmac("sha256", SECRET).update(raw).digest("hex");
    expect((await send(raw, legacy)).status).toBe(401);
  });

  it("[SEC-05] a valid signature over a re-serialized body (re-ordered / whitespace) → 401", async () => {
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    const signature = sign(raw);
    const reformatted = JSON.stringify(JSON.parse(raw), null, 2);
    expect((await send(reformatted, signature)).status).toBe(401);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(parsed).reverse()),
    );
    expect((await send(reordered, signature)).status).toBe(401);
  });

  it("[SEC-05] a timestamp older than 300 s → 401 (replay)", async () => {
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    expect((await send(raw, sign(raw, SECRET, nowSec() - 301))).status).toBe(
      401,
    );
    expect((await send(raw, sign(raw, SECRET, nowSec() + 301))).status).toBe(
      401,
    );
  });

  it("[SEC-05] a signature made with another secret → 401", async () => {
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    expect((await send(raw, sign(raw, "whsec_other"))).status).toBe(401);
  });

  it("[SEC-05] any one of several v1 signatures may match (secret rotation)", async () => {
    await setPlan(ETenantPlan.BASIC);
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    const t = nowSec();
    const wrong = createHmac("sha256", "old_secret")
      .update(`${t}.${raw}`)
      .digest("hex");
    const valid = sign(raw, SECRET, t).split(",v1=")[1];
    const res = await send(raw, `t=${t},v1=${wrong},v1=${valid}`);
    expect(res.status).toBe(200);
    expect((await tenantRow()).plan).toBe(ETenantPlan.PROFESSIONAL);
  });

  it("[SEC-05] the router is not mounted when BILLING_WEBHOOK_SECRET is unset → 404", async () => {
    const raw = event("checkout.session.completed", checkoutCompleted("PRO"));
    const request = () =>
      new Request("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
      });

    const disabled = new Elysia()
      .use(ErrorHandler)
      .use(createRouter({ ...test_env, BILLING_WEBHOOK_SECRET: undefined }));
    expect((await disabled.handle(request())).status).toBe(404);

    const enabled = new Elysia().use(ErrorHandler).use(createRouter(test_env));
    expect((await enabled.handle(request())).status).toBe(401);
  });
});

describe("SEC-05: billing webhook processing", () => {
  it("[SEC-05] checkout.session.completed with a valid signature upgrades the tenant and grants PlanGuard access", async () => {
    await setPlan(ETenantPlan.BASIC);

    const protectedApp = new Elysia()
      .use(Context.User())
      // PlanGuard is opt-in per router [QLT-05].
      .macro("PlanGuard", UtilPlanGuard.macro)
      .get("/pro-feature", () => ({ feature: "unlocked" }), {
        PlanGuard: [ETenantPlan.PROFESSIONAL],
      });
    const protectedClient = treaty(protectedApp);
    const userHeaders = await testHeaders();

    const initialRes = await protectedClient["pro-feature"].get({
      headers: userHeaders,
    });
    // [CORE-07] insufficient plan is 403 PLAN_UPGRADE_REQUIRED (was 426).
    expect(initialRes.status).toBe(403);

    const raw = event(
      "checkout.session.completed",
      checkoutCompleted("PROFESSIONAL"),
    );
    const res = await send(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      success: true,
      event: "checkout.session.completed",
      tenantId: test_tenant.id,
      plan: ETenantPlan.PROFESSIONAL,
    });

    const updated = await tenantRow();
    expect(updated.plan).toBe(ETenantPlan.PROFESSIONAL);
    expect(updated.customerId).toBe("cus_stripe_123");
    expect(updated.subscriptionId).toBe("sub_stripe_abc");
    expect(await auditRows("SUBSCRIPTION_CREATED")).toHaveLength(1);

    const postUpgradeRes = await protectedClient["pro-feature"].get({
      headers: userHeaders,
    });
    expect(postUpgradeRes.status).toBe(200);
  });

  it("[SEC-05] the same event id delivered twice is processed once", async () => {
    await setPlan(ETenantPlan.BASIC);
    const raw = event(
      "checkout.session.completed",
      checkoutCompleted("PRO"),
      "evt_duplicate_1",
    );

    const first = await send(raw, sign(raw));
    expect(first.status).toBe(200);
    expect((await tenantRow()).plan).toBe(ETenantPlan.PROFESSIONAL);

    // If the second delivery were re-applied the plan would flip back.
    await setPlan(ETenantPlan.BASIC);
    const second = await send(raw, sign(raw));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect((await tenantRow()).plan).toBe(ETenantPlan.BASIC);
    expect(await auditRows("SUBSCRIPTION_CREATED")).toHaveLength(1);
  });

  it("[SEC-05] an unknown plan string keeps the current plan and is ignored", async () => {
    await setPlan(ETenantPlan.BASIC);
    const raw = event(
      "checkout.session.completed",
      checkoutCompleted("PLATINUM_DELUXE"),
    );
    const res = await send(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect((await tenantRow()).plan).toBe(ETenantPlan.BASIC);
  });

  it("[SEC-05] a missing plan never maps to the paid STANDARD tier", async () => {
    await setPlan(ETenantPlan.BASIC);
    const raw = event("checkout.session.completed", checkoutCompleted());
    const res = await send(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect((await tenantRow()).plan).toBe(ETenantPlan.BASIC);
  });

  it("[SEC-05] an unknown tenant → 200 { ignored: true } so the provider stops retrying", async () => {
    const raw = event("checkout.session.completed", {
      client_reference_id: "00000000-0000-0000-0000-999999999999",
      customer: "cus_unknown",
      subscription: "sub_unknown",
      metadata: { plan: "PRO" },
    });
    const res = await send(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
  });

  it("[SEC-05] tenant update, audit row and event record commit or roll back together", async () => {
    await setPlan(ETenantPlan.BASIC);
    await test_db.execute(sql`
      CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'audit insert failed'; END $$ LANGUAGE plpgsql;
    `);
    await test_db.execute(sql`
      CREATE TRIGGER test_fail_audit BEFORE INSERT ON system_audit_logs
      FOR EACH ROW EXECUTE FUNCTION test_fail_audit();
    `);
    const raw = event(
      "checkout.session.completed",
      checkoutCompleted("PRO"),
      "evt_atomic_1",
    );
    try {
      expect((await send(raw, sign(raw))).status).toBe(500);
      expect((await tenantRow()).plan).toBe(ETenantPlan.BASIC);
    } finally {
      await test_db.execute(
        sql`DROP TRIGGER IF EXISTS test_fail_audit ON system_audit_logs`,
      );
      await test_db.execute(sql`DROP FUNCTION IF EXISTS test_fail_audit()`);
    }

    // The failed attempt left no event record, so the retry is processed.
    expect((await send(raw, sign(raw))).status).toBe(200);
    expect((await tenantRow()).plan).toBe(ETenantPlan.PROFESSIONAL);
  });

  it("customer.subscription.updated: updates the subscription end date and logs an audit event", async () => {
    const newPeriodEnd = nowSec() + 90 * 24 * 60 * 60;
    const raw = event("customer.subscription.updated", {
      id: "sub_stripe_abc",
      customer: "cus_stripe_123",
      current_period_start: nowSec(),
      current_period_end: newPeriodEnd,
      metadata: { tenantId: test_tenant.id, plan: "PROFESSIONAL" },
    });
    const res = await send(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      success: true,
      event: "customer.subscription.updated",
      tenantId: test_tenant.id,
      plan: ETenantPlan.PROFESSIONAL,
    });
    const updated = await tenantRow();
    expect(Math.floor(updated.planEnd.getTime() / 1000)).toBe(newPeriodEnd);
    expect(await auditRows("SUBSCRIPTION_UPDATED")).toHaveLength(1);
  });

  it("customer.subscription.deleted: downgrades the tenant to BASIC and revokes PlanGuard access", async () => {
    const raw = event("customer.subscription.deleted", {
      id: "sub_stripe_abc",
      customer: "cus_stripe_123",
      metadata: { tenantId: test_tenant.id },
    });
    const res = await send(raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      success: true,
      event: "customer.subscription.deleted",
      tenantId: test_tenant.id,
      plan: ETenantPlan.BASIC,
    });
    expect((await tenantRow()).plan).toBe(ETenantPlan.BASIC);
    expect(await auditRows("SUBSCRIPTION_CANCELED")).toHaveLength(1);

    const protectedApp = new Elysia()
      .use(Context.User())
      // PlanGuard is opt-in per router [QLT-05].
      .macro("PlanGuard", UtilPlanGuard.macro)
      .get("/pro-feature", () => ({ feature: "unlocked" }), {
        PlanGuard: [ETenantPlan.PROFESSIONAL],
      });
    const blockedRes = await treaty(protectedApp)["pro-feature"].get({
      headers: await testHeaders(),
    });
    // [CORE-07] insufficient plan is 403 PLAN_UPGRADE_REQUIRED (was 426).
    expect(blockedRes.status).toBe(403);
  });
});
