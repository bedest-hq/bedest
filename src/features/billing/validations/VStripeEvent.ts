import { Static, t } from "elysia";

/** Minimal envelope every Stripe event shares. */
export const VStripeEvent = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
  type: t.String({ minLength: 1, maxLength: 100 }),
  data: t.Object({
    object: t.Record(t.String(), t.Unknown()),
  }),
});

export type TStripeEvent = Static<typeof VStripeEvent>;
