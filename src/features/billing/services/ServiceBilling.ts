import { IApp, UtilTenantScope } from "bedest-core";
import { STenant } from "@/features/tenant/schemas/STenant";
import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";
import ServiceSystemLog from "@/features/system/services/ServiceSystemLog";
import { eq } from "drizzle-orm";
import { status } from "elysia";
import { logger } from "@/infrastructure/logger/logger";

export function mapPlan(rawPlan?: unknown): ETenantPlan {
  if (typeof rawPlan !== "string") {
    return ETenantPlan.STANDARD;
  }
  const upper = rawPlan.toUpperCase();
  if (upper === "PRO" || upper === "PROFESSIONAL" || upper === "ENTERPRISE") {
    return ETenantPlan.PROFESSIONAL;
  }
  if (upper === "STANDARD" || upper === "STARTER" || upper === "GROWTH") {
    return ETenantPlan.STANDARD;
  }
  if (upper === "BASIC" || upper === "FREE") {
    return ETenantPlan.BASIC;
  }
  return ETenantPlan.STANDARD;
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

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret?: string,
): boolean {
  if (!secret) {
    return true;
  }
  if (!signatureHeader) {
    return false;
  }
  if (signatureHeader === secret) {
    return true;
  }

  try {
    const parts = signatureHeader.split(",");
    const tPart = parts.find((p) => p.startsWith("t="))?.slice(2);
    const v1Part = parts.find((p) => p.startsWith("v1="))?.slice(3);

    if (tPart && v1Part) {
      const payloadToSign = `${tPart}.${rawBody}`;
      const hasher = new Bun.CryptoHasher("sha256", secret);
      hasher.update(payloadToSign);
      const computed = hasher.digest("hex");
      return computed === v1Part;
    }

    const hasher = new Bun.CryptoHasher("sha256", secret);
    hasher.update(rawBody);
    const computed = hasher.digest("hex");
    return computed === signatureHeader;
  } catch {
    return false;
  }
}

export interface IBillingWebhookResult {
  success: boolean;
  event: string;
  tenantId: string;
  plan: ETenantPlan;
}

interface IPlanData {
  nickname?: string;
  id?: string;
}

interface ISubscriptionData {
  plan?: IPlanData;
  current_period_start?: number | string | Date;
  current_period_end?: number | string | Date;
  items?: { data?: Array<{ plan?: IPlanData }> };
}

export class ServiceBilling {
  async handleWebhook(
    c: IApp,
    payload: Record<string, unknown>,
  ): Promise<IBillingWebhookResult> {
    const event = String(payload.type || payload.event || "unknown");
    const dataObj =
      (payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>).object
        : null) || payload;

    const dataRecord = (dataObj || {}) as Record<string, unknown> &
      ISubscriptionData;

    const metadata =
      dataRecord.metadata && typeof dataRecord.metadata === "object"
        ? (dataRecord.metadata as Record<string, unknown>)
        : {};

    const tenantIdCandidate =
      (metadata.tenantId as string) ||
      (metadata.tenant_id as string) ||
      (dataRecord.client_reference_id as string) ||
      (dataRecord.tenantId as string) ||
      (payload.tenantId as string);

    const customerId =
      (dataRecord.customer as string) ||
      (dataRecord.customerId as string) ||
      (payload.customerId as string);

    const subscriptionId =
      (dataRecord.subscription as string) ||
      (dataRecord.id as string) ||
      (payload.subscriptionId as string);

    // Find target tenant
    let targetTenantId = tenantIdCandidate;
    if (targetTenantId) {
      const [exists] = await UtilTenantScope.systemScope(c.db, async (tx) => {
        return await tx
          .select({ id: STenant.id })
          .from(STenant)
          .where(eq(STenant.id, targetTenantId))
          .limit(1);
      });

      if (!exists) {
        logger.warn(
          { event, targetTenantId },
          "[ServiceBilling] Target tenant ID does not exist in database",
        );
        throw status("Not Found", "Tenant not found for billing event");
      }
    } else {
      const [found] = await UtilTenantScope.systemScope(c.db, async (tx) => {
        if (customerId) {
          return await tx
            .select({ id: STenant.id })
            .from(STenant)
            .where(eq(STenant.customerId, customerId))
            .limit(1);
        }
        if (subscriptionId) {
          return await tx
            .select({ id: STenant.id })
            .from(STenant)
            .where(eq(STenant.subscriptionId, subscriptionId))
            .limit(1);
        }
        return [];
      });

      if (found) {
        targetTenantId = found.id;
      }
    }

    if (!targetTenantId) {
      logger.warn(
        { event, customerId, subscriptionId },
        "[ServiceBilling] No tenant found for webhook",
      );
      throw status("Not Found", "Tenant not found for billing event");
    }

    let resultingPlan: ETenantPlan = ETenantPlan.BASIC;

    switch (event) {
      case "checkout.session.completed":
      case "subscription.created":
      case "customer.subscription.created": {
        const rawPlan =
          metadata.plan ||
          dataRecord.plan?.nickname ||
          dataRecord.plan?.id ||
          payload.plan;

        resultingPlan = mapPlan(rawPlan);
        const planStart =
          parseDate(dataRecord.current_period_start) || c.nowDatetime;
        const planEnd =
          parseDate(dataRecord.current_period_end) ||
          new Date(c.nowDatetime.getTime() + 30 * 24 * 60 * 60 * 1000);

        await UtilTenantScope.systemScope(c.db, async (tx) => {
          await tx
            .update(STenant)
            .set({
              plan: resultingPlan,
              planStart,
              planEnd,
              customerId: customerId || undefined,
              subscriptionId: subscriptionId || undefined,
            })
            .where(eq(STenant.id, targetTenantId));
        });

        await ServiceSystemLog.logEvent(c.db, {
          tenantId: targetTenantId,
          action: "SUBSCRIPTION_CREATED",
          entity: "tenant",
          entityId: targetTenantId,
          payload: {
            plan: resultingPlan,
            planStart,
            planEnd,
            customerId,
            subscriptionId,
          },
        });
        break;
      }

      case "customer.subscription.updated": {
        const rawPlan =
          metadata.plan ||
          dataRecord.plan?.nickname ||
          dataRecord.items?.data?.[0]?.plan?.nickname ||
          payload.plan;

        resultingPlan = mapPlan(rawPlan);
        const planStart = parseDate(dataRecord.current_period_start);
        const planEnd = parseDate(dataRecord.current_period_end);

        await UtilTenantScope.systemScope(c.db, async (tx) => {
          const updatePayload: Partial<typeof STenant.$inferInsert> = {
            plan: resultingPlan,
          };
          if (planStart) {
            updatePayload.planStart = planStart;
          }
          if (planEnd) {
            updatePayload.planEnd = planEnd;
          }
          if (subscriptionId) {
            updatePayload.subscriptionId = subscriptionId;
          }
          await tx
            .update(STenant)
            .set(updatePayload)
            .where(eq(STenant.id, targetTenantId));
        });

        await ServiceSystemLog.logEvent(c.db, {
          tenantId: targetTenantId,
          action: "SUBSCRIPTION_UPDATED",
          entity: "tenant",
          entityId: targetTenantId,
          payload: {
            plan: resultingPlan,
            planStart,
            planEnd,
            subscriptionId,
          },
        });
        break;
      }

      case "customer.subscription.deleted":
      case "subscription.canceled": {
        resultingPlan = ETenantPlan.BASIC;

        await UtilTenantScope.systemScope(c.db, async (tx) => {
          await tx
            .update(STenant)
            .set({
              plan: ETenantPlan.BASIC,
            })
            .where(eq(STenant.id, targetTenantId));
        });

        await ServiceSystemLog.logEvent(c.db, {
          tenantId: targetTenantId,
          action: "SUBSCRIPTION_CANCELED",
          entity: "tenant",
          entityId: targetTenantId,
          payload: {
            plan: ETenantPlan.BASIC,
            subscriptionId,
          },
        });
        break;
      }

      default: {
        logger.info({ event }, "[ServiceBilling] Unhandled webhook event type");
        break;
      }
    }

    return {
      success: true,
      event,
      tenantId: targetTenantId,
      plan: resultingPlan,
    };
  }
}

export default new ServiceBilling();
