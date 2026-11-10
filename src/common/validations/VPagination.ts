import { t, type TSchema } from "elysia";

/** Optional keyset cursor of list endpoints (UtilCursor) [PERF-02]. */
export const VCursor = t.Optional(t.String({ minLength: 1, maxLength: 200 }));

/**
 * Response of a list that supports both page/limit and cursor pagination
 * [PERF-02]: page mode adds total/page/totalPages, both modes return
 * nextCursor (null on the last page).
 */
export const VCursorPage = <T extends TSchema>(item: T) =>
  t.Object({
    data: t.Array(item),
    meta: t.Object({
      limit: t.Number(),
      nextCursor: t.Nullable(t.String()),
      total: t.Optional(t.Number()),
      page: t.Optional(t.Number()),
      totalPages: t.Optional(t.Number()),
    }),
  });
