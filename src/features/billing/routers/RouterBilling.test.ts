import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { Elysia } from "elysia";
import Context from "@/app/Context";
import { RouterBilling } from "./RouterBilling";
import {
  test_db,
  test_tenant,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { STenant } from "@/features/tenant/schemas/STenant";
import { SSystemLog } from "@/features/system/schemas/SSystemLog";
import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";
import { eq, and } from "drizzle-orm";

const billingApi = treaty(RouterBilling);

describe("RouterBilling & PlanGuard Subscription Lifecycle", () => {
  it("checkout.session.completed: upgrades tenant to PROFESSIONAL and grants PlanGuard access", async () => {
    // 1. Ensure test tenant starts at BASIC plan
    await test_db
      .update(STenant)
      .set({
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(eq(STenant.id, test_tenant.id));

    // Verify PlanGuard rejects access to PROFESSIONAL endpoint
    const protectedApp = new Elysia()
      .use(Context.User())
      .get("/pro-feature", () => ({ feature: "unlocked" }), {
        PlanGuard: [ETenantPlan.PROFESSIONAL],
      });

    const protectedClient = treaty(protectedApp);
    const userHeaders = await testHeaders();

    const initialRes = await protectedClient["pro-feature"].get({
      headers: userHeaders,
    });
    expect(initialRes.status).toBe(426);

    // 2. Process checkout.session.completed webhook
    const periodEnd = Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60; // 60 days
    const webhookRes = await billingApi.billing.webhook.post({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: test_tenant.id,
          customer: "cus_stripe_123",
          subscription: "sub_stripe_abc",
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: periodEnd,
          metadata: {
            plan: "PROFESSIONAL",
            tenantId: test_tenant.id,
          },
        },
      },
    });

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.data).toStrictEqual({
      success: true,
      event: "checkout.session.completed",
      tenantId: test_tenant.id,
      plan: ETenantPlan.PROFESSIONAL,
    });

    // 3. Verify STenant record in DB updated
    const [updatedTenant] = await test_db
      .select()
      .from(STenant)
      .where(eq(STenant.id, test_tenant.id));

    expect(updatedTenant.plan).toBe(ETenantPlan.PROFESSIONAL);
    expect(updatedTenant.customerId).toBe("cus_stripe_123");
    expect(updatedTenant.subscriptionId).toBe("sub_stripe_abc");

    // 4. Verify system_audit_logs entry created
    const [auditLog] = await test_db
      .select()
      .from(SSystemLog)
      .where(
        and(
          eq(SSystemLog.tenantId, test_tenant.id),
          eq(SSystemLog.action, "SUBSCRIPTION_CREATED"),
        ),
      );

    expect(auditLog).toBeDefined();
    expect(auditLog.action).toBe("SUBSCRIPTION_CREATED");

    // 5. Verify PlanGuard now GRANTS access to PROFESSIONAL endpoint
    const postUpgradeRes = await protectedClient["pro-feature"].get({
      headers: userHeaders,
    });
    expect(postUpgradeRes.status).toBe(200);
    expect(postUpgradeRes.data).toStrictEqual({ feature: "unlocked" });
  });

  it("customer.subscription.updated: updates subscription end date and logs audit event", async () => {
    const newPeriodEnd = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days

    const webhookRes = await billingApi.billing.webhook.post({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_stripe_abc",
          customer: "cus_stripe_123",
          current_period_end: newPeriodEnd,
          metadata: {
            tenantId: test_tenant.id,
          },
        },
      },
    });

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.data?.success).toBe(true);

    // Verify STenant has extended planEnd
    const [tenant] = await test_db
      .select()
      .from(STenant)
      .where(eq(STenant.id, test_tenant.id));

    expect(tenant.planEnd.getTime()).toBeGreaterThan(Date.now());

    // Verify audit log
    const [auditLog] = await test_db
      .select()
      .from(SSystemLog)
      .where(
        and(
          eq(SSystemLog.tenantId, test_tenant.id),
          eq(SSystemLog.action, "SUBSCRIPTION_UPDATED"),
        ),
      );

    expect(auditLog).toBeDefined();
    expect(auditLog.action).toBe("SUBSCRIPTION_UPDATED");
  });

  it("customer.subscription.deleted: downgrades tenant to BASIC and revokes PlanGuard access", async () => {
    // 1. Process customer.subscription.deleted
    const webhookRes = await billingApi.billing.webhook.post({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_stripe_abc",
          customer: "cus_stripe_123",
          metadata: {
            tenantId: test_tenant.id,
          },
        },
      },
    });

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.data).toStrictEqual({
      success: true,
      event: "customer.subscription.deleted",
      tenantId: test_tenant.id,
      plan: ETenantPlan.BASIC,
    });

    // 2. Verify STenant record in DB is now BASIC
    const [downgradedTenant] = await test_db
      .select()
      .from(STenant)
      .where(eq(STenant.id, test_tenant.id));

    expect(downgradedTenant.plan).toBe(ETenantPlan.BASIC);

    // 3. Verify audit log
    const [auditLog] = await test_db
      .select()
      .from(SSystemLog)
      .where(
        and(
          eq(SSystemLog.tenantId, test_tenant.id),
          eq(SSystemLog.action, "SUBSCRIPTION_CANCELED"),
        ),
      );

    expect(auditLog).toBeDefined();
    expect(auditLog.action).toBe("SUBSCRIPTION_CANCELED");

    // 4. Verify PlanGuard now BLOCKS access with 403 Forbidden
    const protectedApp = new Elysia()
      .use(Context.User())
      .get("/pro-feature", () => ({ feature: "unlocked" }), {
        PlanGuard: [ETenantPlan.PROFESSIONAL],
      });

    const protectedClient = treaty(protectedApp);
    const userHeaders = await testHeaders();

    const blockedRes = await protectedClient["pro-feature"].get({
      headers: userHeaders,
    });
    expect(blockedRes.status).toBe(426);
  });

  it("Webhook Signature: Rejects invalid or missing signature when secret is configured", async () => {
    const secret = "whsec_test_secret_123";
    const originalSecret = Bun.env.BILLING_WEBHOOK_SECRET;
    Bun.env.BILLING_WEBHOOK_SECRET = secret;

    try {
      const payload = {
        type: "customer.subscription.updated",
        tenantId: test_tenant.id,
      };

      // Missing signature header
      const noSigRes = await billingApi.billing.webhook.post(payload);
      expect(noSigRes.status).toBe(401);

      // Invalid signature header
      const badSigRes = await billingApi.billing.webhook.post(payload, {
        headers: {
          "stripe-signature": "invalid_sig",
        },
      });
      expect(badSigRes.status).toBe(401);

      // Valid signature header (simple secret match or HMAC)
      const validSigRes = await billingApi.billing.webhook.post(payload, {
        headers: {
          "stripe-signature": secret,
        },
      });
      expect(validSigRes.status).toBe(200);
    } finally {
      if (originalSecret !== undefined) {
        Bun.env.BILLING_WEBHOOK_SECRET = originalSecret;
      } else {
        delete Bun.env.BILLING_WEBHOOK_SECRET;
      }
    }
  });

  it("Negative: Non-existent tenant returns 404 Not Found", async () => {
    const res = await billingApi.billing.webhook.post({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "00000000-0000-0000-0000-999999999999",
          customer: "cus_unknown",
          subscription: "sub_unknown",
        },
      },
    });

    expect(res.status).toBe(404);
  });
});
