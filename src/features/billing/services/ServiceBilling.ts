import { and, eq, type SQL } from "drizzle-orm";
import { IApp, TDbOrTx, UtilTenantScope } from "bedest-core";
import { STenant } from "@/features/tenant/schemas/STenant";
import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";
import ServiceSystemLog from "@/features/system/services/ServiceSystemLog";
import { logger } from "@/infrastructure/logger/logger";
import { SBillingEvent } from "../schemas/SBillingEvent";
import { TStripeEvent } from "../validations/VStripeEvent";

/** Maps a provider plan label to a plan; `null` for anything unknown. */
export function mapPlan(rawPlan?: unknown): ETenantPlan | null {
  if (typeof rawPlan !== "string") {
    return null;
  }
  const upper = rawPlan.trim().toUpperCase();
  if (upper === "PRO" || upper === "PROFESSIONAL" || upper === "ENTERPRISE") {
    return ETenantPlan.PROFESSIONAL;
  }
  if (upper === "STANDARD" || upper === "STARTER" || upper === "GROWTH") {
    return ETenantPlan.STANDARD;
  }
  if (upper === "BASIC" || upper === "FREE") {
    return ETenantPlan.BASIC;
  }
  return null;
}

export function parseDate(val: unknown): Date | null {
  if (!val) {
    return null;
  }
  if (typeof val === "number") {
    // If Unix timestamp in seconds (Stripe style)
    if (val < 10000000000) {
      return new Date(val * 1000);
    }
    return new Date(val);
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  if (val instanceof Date) {
    return val;
  }
  return null;
}

export interface IBillingWebhookResult {
  success: boolean;
  event: string;
  tenantId?: string;
  plan?: ETenantPlan;
  ignored?: boolean;
  duplicate?: boolean;
  reason?: string;
}

type TRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is TRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ServiceBilling {
  /**
   * Processes a verified provider event exactly once: the event record,
   * the tenant update and the audit row are written in one transaction.
   */
  async handleEvent(
    c: IApp,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    return await UtilTenantScope.systemScope(c.db, async (tx) => {
      const [fresh] = await tx
        .insert(SBillingEvent)
        .values({ id: evt.id, type: evt.type, receivedAt: c.nowDatetime })
        .onConflictDoNothing()
        .returning({ id: SBillingEvent.id });

      if (!fresh) {
        logger.info(
          { eventId: evt.id, event: evt.type },
          "[ServiceBilling] Duplicate webhook delivery ignored",
        );
        return { success: true, event: evt.type, duplicate: true };
      }

      const result = await this.apply(tx, c, evt);

      await tx
        .update(SBillingEvent)
        .set({ processedAt: c.nowDatetime })
        .where(eq(SBillingEvent.id, evt.id));

      return result;
    });
  }

  private async findTenantId(
    tx: TDbOrTx,
    ref: { tenantId?: string; customerId?: string; subscriptionId?: string },
  ): Promise<string | undefined> {
    // An explicit tenant id is authoritative (and must be a UUID); otherwise
    // the customer and then the subscription reference are tried in turn.
    if (ref.tenantId) {
      return UUID_RE.test(ref.tenantId)
        ? await this.activeTenant(tx, eq(STenant.id, ref.tenantId))
        : undefined;
    }
    if (ref.customerId) {
      const byCustomer = await this.activeTenant(
        tx,
        eq(STenant.customerId, ref.customerId),
      );
      if (byCustomer) {
        return byCustomer;
      }
    }
    if (ref.subscriptionId) {
      return await this.activeTenant(
        tx,
        eq(STenant.subscriptionId, ref.subscriptionId),
      );
    }
    return undefined;
  }

  private async activeTenant(tx: TDbOrTx, match: SQL) {
    const [row] = await tx
      .select({ id: STenant.id })
      .from(STenant)
      .where(and(match, eq(STenant.isDeleted, false)))
      .limit(1);
    return row?.id;
  }

  private async apply(
    tx: TDbOrTx,
    c: IApp,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    switch (evt.type) {
      case "checkout.session.completed":
        return await this.onCheckoutCompleted(tx, c, evt);
      case "customer.subscription.created":
      case "customer.subscription.updated":
        return await this.onSubscriptionChanged(tx, c, evt);
      case "customer.subscription.deleted":
        return await this.onSubscriptionDeleted(tx, evt);
      case "invoice.paid":
        return await this.onInvoicePaid(tx, evt);
      case "invoice.payment_failed":
        return await this.onInvoicePaymentFailed(tx, evt);
      default: {
        logger.info(
          { eventId: evt.id, event: evt.type },
          "[ServiceBilling] Unhandled webhook event type",
        );
        return {
          success: true,
          event: evt.type,
          ignored: true,
          reason: "unhandled_event",
        };
      }
    }
  }

  private unknownTenant(evt: TStripeEvent, ref: object): IBillingWebhookResult {
    logger.warn(
      { eventId: evt.id, event: evt.type, ...ref },
      "[ServiceBilling] No tenant found for webhook; ignoring",
    );
    return {
      success: true,
      event: evt.type,
      ignored: true,
      reason: "unknown_tenant",
    };
  }

  private unknownPlan(
    evt: TStripeEvent,
    tenantId: string,
    rawPlan: unknown,
  ): IBillingWebhookResult {
    logger.warn(
      { eventId: evt.id, event: evt.type, tenantId, rawPlan },
      "[ServiceBilling] Unknown plan; keeping the current plan",
    );
    return {
      success: true,
      event: evt.type,
      tenantId,
      ignored: true,
      reason: "unknown_plan",
    };
  }

  /** Checkout Session: the subscription id is only ever `.subscription`. */
  private async onCheckoutCompleted(
    tx: TDbOrTx,
    c: IApp,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    const session = evt.data.object;
    const metadata = rec(session.metadata);
    const customerId = str(session.customer);
    const subscriptionId = str(session.subscription);

    const tenantId = await this.findTenantId(tx, {
      tenantId:
        str(metadata.tenantId) ??
        str(metadata.tenant_id) ??
        str(session.client_reference_id),
      customerId,
    });
    if (!tenantId) {
      return this.unknownTenant(evt, { customerId });
    }

    const plan = mapPlan(metadata.plan);
    if (!plan) {
      return this.unknownPlan(evt, tenantId, metadata.plan);
    }

    // Period dates arrive with the subscription and invoice events.
    const planStart = c.nowDatetime;
    const planEnd = new Date(c.nowDatetime.getTime() + 30 * DAY_MS);
    await tx
      .update(STenant)
      .set({
        plan,
        planStart,
        planEnd,
        ...(customerId ? { customerId } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
      })
      .where(eq(STenant.id, tenantId));

    await ServiceSystemLog.insertEvent(tx, {
      tenantId,
      action: "SUBSCRIPTION_CREATED",
      entity: "tenant",
      entityId: tenantId,
      payload: {
        eventId: evt.id,
        plan,
        planStart: planStart.toISOString(),
        planEnd: planEnd.toISOString(),
        customerId,
        subscriptionId: subscriptionId ?? null,
      },
    });
    return { success: true, event: evt.type, tenantId, plan };
  }

  /** customer.subscription.created | customer.subscription.updated */
  private async onSubscriptionChanged(
    tx: TDbOrTx,
    c: IApp,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    const sub = evt.data.object;
    const metadata = rec(sub.metadata);
    const subscriptionId = str(sub.id);
    const customerId = str(sub.customer);
    const tenantId = await this.findTenantId(tx, {
      tenantId: str(metadata.tenantId) ?? str(metadata.tenant_id),
      customerId,
      subscriptionId,
    });
    if (!tenantId) {
      return this.unknownTenant(evt, { customerId, subscriptionId });
    }

    const rawPlan = subscriptionPlan(sub);
    const plan = mapPlan(rawPlan);
    if (!plan) {
      return this.unknownPlan(evt, tenantId, rawPlan);
    }

    const { start, end } = subscriptionPeriod(sub);
    const created = evt.type === "customer.subscription.created";
    const planStart = start ?? (created ? c.nowDatetime : null);
    const planEnd =
      end ?? (created ? new Date(c.nowDatetime.getTime() + 30 * DAY_MS) : null);

    await tx
      .update(STenant)
      .set({
        plan,
        ...(planStart ? { planStart } : {}),
        ...(planEnd ? { planEnd } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
        ...(customerId ? { customerId } : {}),
      })
      .where(eq(STenant.id, tenantId));

    await ServiceSystemLog.insertEvent(tx, {
      tenantId,
      action: created ? "SUBSCRIPTION_CREATED" : "SUBSCRIPTION_UPDATED",
      entity: "tenant",
      entityId: tenantId,
      payload: {
        eventId: evt.id,
        plan,
        planStart: planStart?.toISOString() ?? null,
        planEnd: planEnd?.toISOString() ?? null,
        subscriptionId: subscriptionId ?? null,
      },
    });
    return { success: true, event: evt.type, tenantId, plan };
  }

  private async onSubscriptionDeleted(
    tx: TDbOrTx,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    const sub = evt.data.object;
    const metadata = rec(sub.metadata);
    const subscriptionId = str(sub.id);
    const customerId = str(sub.customer);
    const tenantId = await this.findTenantId(tx, {
      tenantId: str(metadata.tenantId) ?? str(metadata.tenant_id),
      customerId,
      subscriptionId,
    });
    if (!tenantId) {
      return this.unknownTenant(evt, { customerId, subscriptionId });
    }

    await tx
      .update(STenant)
      .set({ plan: ETenantPlan.BASIC })
      .where(eq(STenant.id, tenantId));

    await ServiceSystemLog.insertEvent(tx, {
      tenantId,
      action: "SUBSCRIPTION_CANCELED",
      entity: "tenant",
      entityId: tenantId,
      payload: {
        eventId: evt.id,
        plan: ETenantPlan.BASIC,
        subscriptionId: subscriptionId ?? null,
      },
    });
    return {
      success: true,
      event: evt.type,
      tenantId,
      plan: ETenantPlan.BASIC,
    };
  }

  /** invoice.paid: extend planEnd to the end of the paid period. */
  private async onInvoicePaid(
    tx: TDbOrTx,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    const invoice = evt.data.object;
    const { tenantId, subscriptionId, customerId } = await this.invoiceTenant(
      tx,
      invoice,
    );
    if (!tenantId) {
      return this.unknownTenant(evt, { customerId, subscriptionId });
    }

    const paidUntil = invoicePeriodEnd(invoice);
    const [current] = await tx
      .select({ planEnd: STenant.planEnd })
      .from(STenant)
      .where(eq(STenant.id, tenantId))
      .limit(1);
    const extended =
      paidUntil !== null &&
      (!current || paidUntil.getTime() > current.planEnd.getTime());
    if (extended) {
      await tx
        .update(STenant)
        .set({ planEnd: paidUntil })
        .where(eq(STenant.id, tenantId));
    }

    await ServiceSystemLog.insertEvent(tx, {
      tenantId,
      action: "INVOICE_PAID",
      entity: "tenant",
      entityId: tenantId,
      payload: {
        eventId: evt.id,
        invoiceId: str(invoice.id) ?? null,
        subscriptionId: subscriptionId ?? null,
        paidUntil: paidUntil?.toISOString() ?? null,
        extended,
      },
    });
    return { success: true, event: evt.type, tenantId };
  }

  /** invoice.payment_failed: log and audit, never change the plan. */
  private async onInvoicePaymentFailed(
    tx: TDbOrTx,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    const invoice = evt.data.object;
    const { tenantId, subscriptionId, customerId } = await this.invoiceTenant(
      tx,
      invoice,
    );
    if (!tenantId) {
      return this.unknownTenant(evt, { customerId, subscriptionId });
    }

    logger.warn(
      { eventId: evt.id, tenantId, subscriptionId },
      "[ServiceBilling] Invoice payment failed",
    );
    await ServiceSystemLog.insertEvent(tx, {
      tenantId,
      action: "PAYMENT_FAILED",
      entity: "tenant",
      entityId: tenantId,
      payload: {
        eventId: evt.id,
        invoiceId: str(invoice.id) ?? null,
        subscriptionId: subscriptionId ?? null,
        attemptCount:
          typeof invoice.attempt_count === "number"
            ? invoice.attempt_count
            : null,
      },
    });
    return { success: true, event: evt.type, tenantId };
  }

  private async invoiceTenant(tx: TDbOrTx, invoice: TRecord) {
    const details = rec(rec(invoice.parent).subscription_details);
    // Older API versions: invoice.subscription; 2025-03-31.basil and later:
    // invoice.parent.subscription_details.subscription.
    const subscriptionId =
      str(invoice.subscription) ?? str(details.subscription);
    const customerId = str(invoice.customer);
    const tenantId = await this.findTenantId(tx, {
      tenantId: str(rec(details.metadata).tenantId),
      customerId,
      subscriptionId,
    });
    return { tenantId, subscriptionId, customerId };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

const rec = (v: unknown): TRecord => (isRecord(v) ? v : {});

const firstItem = (sub: TRecord): TRecord => {
  const data = rec(sub.items).data;
  return Array.isArray(data) ? rec(data[0]) : {};
};

/**
 * Billing period of a subscription. API versions before 2025-03-31.basil
 * put current_period_* on the subscription; basil and later only on its
 * items [BUG-07][VERIFY]. Both shapes are read.
 */
export const subscriptionPeriod = (sub: TRecord) => {
  const item = firstItem(sub);
  return {
    start:
      parseDate(sub.current_period_start) ??
      parseDate(item.current_period_start),
    end: parseDate(sub.current_period_end) ?? parseDate(item.current_period_end),
  };
};

/** metadata.plan wins, then the first item price (metadata, lookup key, nickname). */
const subscriptionPlan = (sub: TRecord): unknown => {
  const item = firstItem(sub);
  const price = rec(item.price);
  return (
    rec(sub.metadata).plan ??
    rec(price.metadata).plan ??
    price.lookup_key ??
    price.nickname ??
    rec(item.plan).nickname ??
    rec(sub.plan).nickname ??
    undefined
  );
};

const invoicePeriodEnd = (invoice: TRecord): Date | null => {
  const lines = rec(invoice.lines).data;
  const ends = (Array.isArray(lines) ? lines : [])
    .map((line) => parseDate(rec(rec(line).period).end))
    .filter((d): d is Date => d !== null);
  if (ends.length === 0) {
    return parseDate(invoice.period_end);
  }
  return new Date(Math.max(...ends.map((d) => d.getTime())));
};

export default new ServiceBilling();
