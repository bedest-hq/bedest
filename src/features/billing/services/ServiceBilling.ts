import { and, eq } from "drizzle-orm";
import { IApp, TTransaction, UtilTenantScope } from "bedest-core";
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
    tx: TTransaction,
    ref: { tenantId?: string; customerId?: string; subscriptionId?: string },
  ): Promise<string | undefined> {
    let match;
    if (ref.tenantId) {
      if (!UUID_RE.test(ref.tenantId)) {
        return undefined;
      }
      match = eq(STenant.id, ref.tenantId);
    } else if (ref.customerId) {
      match = eq(STenant.customerId, ref.customerId);
    } else if (ref.subscriptionId) {
      match = eq(STenant.subscriptionId, ref.subscriptionId);
    } else {
      return undefined;
    }

    const [row] = await tx
      .select({ id: STenant.id })
      .from(STenant)
      .where(and(match, eq(STenant.isDeleted, false)))
      .limit(1);
    return row?.id;
  }

  private async apply(
    tx: TTransaction,
    c: IApp,
    evt: TStripeEvent,
  ): Promise<IBillingWebhookResult> {
    const obj = evt.data.object;
    const metadata = isRecord(obj.metadata) ? obj.metadata : {};
    const planObj = isRecord(obj.plan) ? obj.plan : {};

    const customerId = str(obj.customer);
    const subscriptionId = str(obj.subscription) ?? str(obj.id);

    const tenantId = await this.findTenantId(tx, {
      tenantId:
        str(metadata.tenantId) ??
        str(metadata.tenant_id) ??
        str(obj.client_reference_id),
      customerId,
      subscriptionId,
    });

    if (!tenantId) {
      logger.warn(
        { eventId: evt.id, event: evt.type, customerId, subscriptionId },
        "[ServiceBilling] No tenant found for webhook; ignoring",
      );
      return {
        success: true,
        event: evt.type,
        ignored: true,
        reason: "unknown_tenant",
      };
    }

    const ignoredPlan = (rawPlan: unknown): IBillingWebhookResult => {
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
    };

    switch (evt.type) {
      case "checkout.session.completed":
      case "customer.subscription.created": {
        const rawPlan = metadata.plan ?? planObj.nickname ?? planObj.id;
        const plan = mapPlan(rawPlan);
        if (!plan) {
          return ignoredPlan(rawPlan);
        }
        const planStart = parseDate(obj.current_period_start) ?? c.nowDatetime;
        const planEnd =
          parseDate(obj.current_period_end) ??
          new Date(c.nowDatetime.getTime() + 30 * 24 * 60 * 60 * 1000);

        await tx
          .update(STenant)
          .set({
            plan,
            planStart,
            planEnd,
            customerId: customerId ?? undefined,
            subscriptionId: subscriptionId ?? undefined,
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
            subscriptionId,
          },
        });
        return { success: true, event: evt.type, tenantId, plan };
      }

      case "customer.subscription.updated": {
        const items = isRecord(obj.items) ? obj.items.data : undefined;
        const firstItem =
          Array.isArray(items) && isRecord(items[0]) ? items[0] : {};
        const itemPlan = isRecord(firstItem.plan) ? firstItem.plan : {};
        const rawPlan = metadata.plan ?? planObj.nickname ?? itemPlan.nickname;
        const plan = mapPlan(rawPlan);
        if (!plan) {
          return ignoredPlan(rawPlan);
        }
        const planStart = parseDate(obj.current_period_start);
        const planEnd = parseDate(obj.current_period_end);

        await tx
          .update(STenant)
          .set({
            plan,
            ...(planStart ? { planStart } : {}),
            ...(planEnd ? { planEnd } : {}),
            ...(subscriptionId ? { subscriptionId } : {}),
          })
          .where(eq(STenant.id, tenantId));

        await ServiceSystemLog.insertEvent(tx, {
          tenantId,
          action: "SUBSCRIPTION_UPDATED",
          entity: "tenant",
          entityId: tenantId,
          payload: {
            eventId: evt.id,
            plan,
            planStart: planStart?.toISOString() ?? null,
            planEnd: planEnd?.toISOString() ?? null,
            subscriptionId,
          },
        });
        return { success: true, event: evt.type, tenantId, plan };
      }

      case "customer.subscription.deleted": {
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
            subscriptionId,
          },
        });
        return {
          success: true,
          event: evt.type,
          tenantId,
          plan: ETenantPlan.BASIC,
        };
      }

      default: {
        logger.info(
          { eventId: evt.id, event: evt.type },
          "[ServiceBilling] Unhandled webhook event type",
        );
        return {
          success: true,
          event: evt.type,
          tenantId,
          ignored: true,
          reason: "unhandled_event",
        };
      }
    }
  }
}

export default new ServiceBilling();
