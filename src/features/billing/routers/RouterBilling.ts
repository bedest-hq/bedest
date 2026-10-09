import { Elysia, status, t } from "elysia";
import Context from "@/app/Context";
import ServiceBilling, {
  verifyWebhookSignature,
} from "../services/ServiceBilling";

export const RouterBilling = new Elysia({
  prefix: "/billing",
  tags: ["Billing"],
})
  .use(Context.App())
  .post(
    "/webhook",
    async ({ body, headers, db, nowDatetime }) => {
      const signature =
        headers["stripe-signature"] ||
        headers["x-webhook-signature"] ||
        null;
      const secret =
        Bun.env.BILLING_WEBHOOK_SECRET || Bun.env.STRIPE_WEBHOOK_SECRET;

      const isValid = verifyWebhookSignature(
        JSON.stringify(body),
        signature,
        secret,
      );

      if (!isValid) {
        throw status("Unauthorized", { message: "Invalid webhook signature" });
      }

      return await ServiceBilling.handleWebhook(
        { db, nowDatetime },
        body,
      );
    },
    {
      body: t.Record(t.String(), t.Unknown()),
    },
  );
