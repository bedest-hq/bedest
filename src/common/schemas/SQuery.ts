import { t } from "elysia";

export const SQuery = t.Object({
  limit: t.Numeric({ default: 20, minimum: 1, maximum: 100 }),
  page: t.Numeric({ default: 1, minimum: 1 }),
});
