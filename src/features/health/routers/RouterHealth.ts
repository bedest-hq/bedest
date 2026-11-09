import { Elysia, t } from "elysia";
import { sql } from "drizzle-orm";
import DbManager from "@/infrastructure/database/DbManager";
import RedisManager from "@/infrastructure/redis/RedisManager";
import StorageManager from "@/infrastructure/storage/StorageManager";
import ServiceHealth from "../services/ServiceHealth";

const VProbe = t.Union([
  t.Literal("ok"),
  t.Literal("error"),
  t.Literal("disabled"),
]);

/**
 * Liveness and readiness [FEAT-01]. Mounted under /api (outside /api/v1):
 * unauthenticated, not rate-limited, not audited and not affected by
 * maintenance mode.
 */
export const RouterHealth = new Elysia({ prefix: "/health", tags: ["Health"] })
  .get("/live", () => ({ status: "ok" as const }), {
    response: t.Object({ status: t.Literal("ok") }),
  })
  .get(
    "/ready",
    async ({ set }) => {
      const readiness = await ServiceHealth.readiness({
        db: () => DbManager.get().execute(sql`SELECT 1`),
        redis: async () =>
          RedisManager.isEnabled()
            ? (await RedisManager.ping())
              ? "ok"
              : "error"
            : "disabled",
        storage: () => StorageManager.healthCheck(),
      });
      if (readiness.status !== "ok") {
        set.status = 503;
      }
      return readiness;
    },
    {
      response: {
        200: t.Object({
          status: t.Union([t.Literal("ok"), t.Literal("error")]),
          reason: t.Optional(t.Literal("shutting_down")),
          checks: t.Object({
            db: t.Union([t.Literal("ok"), t.Literal("error")]),
            redis: VProbe,
            storage: VProbe,
          }),
        }),
        503: t.Object({
          status: t.Union([t.Literal("ok"), t.Literal("error")]),
          reason: t.Optional(t.Literal("shutting_down")),
          checks: t.Object({
            db: t.Union([t.Literal("ok"), t.Literal("error")]),
            redis: VProbe,
            storage: VProbe,
          }),
        }),
      },
    },
  );
