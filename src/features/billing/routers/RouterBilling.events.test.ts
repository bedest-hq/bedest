import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import { RouterBilling } from "./RouterBilling";
import {
  test_db,
  test_env,
  test_tenant,
} from "@/common/tests/TestManager.test";
import { STenant } from "@/features/tenant/schemas/STenant";
import { SSystemLog } from "@/features/system/schemas/SSystemLog";
import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";

const SECRET = test_env.BILLING_WEBHOOK_SECRET ?? "";
const nowSec = () => Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

const app = new Elysia().use(ErrorHandler).use(RouterBilling);

const deliver = async (type: string, object: Record<string, unknown>) => {
  const raw = JSON.stringify({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    api_version: "2025-03-31.basil",
    type,
    data: { object },
  });
  const t = nowSec();
  const sig = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
  const res = await app.handle(
    new Request("http://localhost/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${t},v1=${sig}`,
      },
      body: raw,
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
};

const tenant = async () => {
  const [row] = await test_db
    .select()
    .from(STenant)
    .where(eq(STenant.id, test_tenant.id));
  return row;
};

const setTenant = (values: Partial<typeof STenant.$inferInsert>) =>
  test_db.update(STenant).set(values).where(eq(STenant.id, test_tenant.id));

const audits = (action: string) =>
  test_db
    .select()
    .from(SSystemLog)
    .where(
      and(
        eq(SSystemLog.tenantId, test_tenant.id),
        eq(SSystemLog.action, action),
      ),
    );

/** A Stripe subscription in the 2025-03-31.basil shape (periods on items). */
const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_123",
  object: "subscription",
  customer: "cus_123",
  status: "active",
  metadata: { tenantId: test_tenant.id },
  items: {
    object: "list",
    data: [
      {
        id: "si_1",
        object: "subscription_item",
        current_period_start: nowSec(),
        current_period_end: nowSec() + 31 * DAY,
        price: {
          id: "price_pro",
          lookup_key: "pro",
          nickname: null,
          metadata: {},
        },
      },
    ],
  },
  ...overrides,
});

describe("BUG-07: billing event semantics", () => {
  it("[BUG-07] checkout.session.completed takes the subscription id only from .subscription (never the cs_ id)", async () => {
    await setTenant({ subscriptionId: null, plan: ETenantPlan.BASIC });
    await deliver("checkout.session.completed", {
      id: "cs_test_abc",
      object: "checkout.session",
      mode: "subscription",
      client_reference_id: test_tenant.id,
      customer: "cus_123",
      subscription: null,
      metadata: { tenantId: test_tenant.id, plan: "PRO" },
    });
    const row = await tenant();
    expect(row.subscriptionId).toBeNull();
    expect(row.customerId).toBe("cus_123");
    expect(row.plan).toBe(ETenantPlan.PROFESSIONAL);
  });

  it("[BUG-07] customer.subscription.created reads item-level periods (2025-03-31.basil) and the plan from the price", async () => {
    await setTenant({ plan: ETenantPlan.BASIC });
    const end = nowSec() + 31 * DAY;
    await deliver("customer.subscription.created", subscription());
    const row = await tenant();
    expect(row.plan).toBe(ETenantPlan.PROFESSIONAL);
    expect(row.subscriptionId).toBe("sub_123");
    expect(
      Math.abs(Math.floor(row.planEnd.getTime() / 1000) - end),
    ).toBeLessThan(5);
  });

  it("[BUG-07] customer.subscription.updated still reads top-level periods of older API versions", async () => {
    const end = nowSec() + 90 * DAY;
    await deliver(
      "customer.subscription.updated",
      subscription({
        current_period_start: nowSec(),
        current_period_end: end,
        items: { data: [{ price: { lookup_key: "standard" } }] },
      }),
    );
    const row = await tenant();
    expect(row.plan).toBe(ETenantPlan.STANDARD);
    expect(Math.floor(row.planEnd.getTime() / 1000)).toBe(end);
  });

  it("[BUG-07] customer.subscription.deleted downgrades to BASIC", async () => {
    await deliver(
      "customer.subscription.deleted",
      subscription({ status: "canceled" }),
    );
    expect((await tenant()).plan).toBe(ETenantPlan.BASIC);
    expect(await audits("SUBSCRIPTION_CANCELED")).toHaveLength(1);
  });

  it("[BUG-07] invoice.paid extends planEnd to the paid period (basil parent.subscription_details shape)", async () => {
    await setTenant({ subscriptionId: "sub_123", planEnd: new Date() });
    const end = nowSec() + 60 * DAY;
    const res = await deliver("invoice.paid", {
      id: "in_1",
      object: "invoice",
      customer: "cus_123",
      parent: {
        subscription_details: { subscription: "sub_123", metadata: {} },
      },
      lines: { data: [{ period: { start: nowSec(), end } }] },
    });
    expect(res.success).toBe(true);
    expect(Math.floor((await tenant()).planEnd.getTime() / 1000)).toBe(end);
    expect(await audits("INVOICE_PAID")).toHaveLength(1);
  });

  it("[BUG-07] invoice.paid never shortens an already longer plan", async () => {
    const later = new Date((nowSec() + 365 * DAY) * 1000);
    await setTenant({ subscriptionId: "sub_123", planEnd: later });
    await deliver("invoice.paid", {
      id: "in_2",
      object: "invoice",
      customer: "cus_123",
      subscription: "sub_123",
      lines: {
        data: [{ period: { start: nowSec(), end: nowSec() + 30 * DAY } }],
      },
    });
    expect((await tenant()).planEnd.getTime()).toBe(later.getTime());
  });

  it("[BUG-07] invoice.payment_failed is audited and does not change the plan", async () => {
    await setTenant({
      subscriptionId: "sub_123",
      plan: ETenantPlan.PROFESSIONAL,
    });
    await deliver("invoice.payment_failed", {
      id: "in_3",
      object: "invoice",
      customer: "cus_123",
      subscription: "sub_123",
      attempt_count: 2,
    });
    expect((await tenant()).plan).toBe(ETenantPlan.PROFESSIONAL);
    expect(await audits("PAYMENT_FAILED")).toHaveLength(1);
  });
});
