import { UtilHttp } from "@/common/utils/UtilHttp";
import { Elysia, t } from "elysia";
import { Value } from "@sinclair/typebox/value";
import Context from "@/app/Context";
import EnvManager from "@/infrastructure/env/EnvManager";
import ServiceBilling from "../services/ServiceBilling";
import { UtilStripeSignature } from "../utils/UtilStripeSignature";
import { VStripeEvent } from "../validations/VStripeEvent";

/**
 * Stripe webhook receiver. Mounted only when BILLING_WEBHOOK_SECRET is set
 * (see src/app/Router.ts). The body is read as raw text so the signature is
 * verified over the exact bytes the provider signed.
 */
export const RouterBilling = new Elysia({
  prefix: "/billing",
  tags: ["Billing"],
})
  .use(Context.App())
  .post(
    "/webhook",
    async ({ body, headers, db, nowDatetime }) => {
      const secret = EnvManager.get().BILLING_WEBHOOK_SECRET ?? "";
      const isValid = UtilStripeSignature.verify(
        body,
        headers["stripe-signature"],
        secret,
        Math.floor(Date.now() / 1000),
      );

      if (!isValid) {
        throw UtilHttp.fail(401, "Invalid webhook signature");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw UtilHttp.fail(400, "Invalid JSON payload");
      }

      if (!Value.Check(VStripeEvent, parsed)) {
        throw UtilHttp.fail(400, "Invalid event payload");
      }

      return await ServiceBilling.handleEvent({ db, nowDatetime }, parsed);
    },
    {
      parse: "text",
      body: t.String({ maxLength: 512 * 1024 }),
      headers: t.Object({
        "stripe-signature": t.Optional(t.String({ maxLength: 4096 })),
      }),
    },
  );
