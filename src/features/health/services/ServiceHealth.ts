export type TProbeResult = "ok" | "error" | "disabled";

export interface IHealthProbes {
  db: () => Promise<unknown>;
  redis: () => Promise<TProbeResult>;
  storage: () => Promise<TProbeResult>;
}

export interface IReadiness {
  status: "ok" | "error";
  reason?: "shutting_down";
  checks: { db: "ok" | "error"; redis: TProbeResult; storage: TProbeResult };
}

const withTimeout = async <T>(probe: () => Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("health probe timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const settle = async (
  probe: () => Promise<TProbeResult>,
  ms: number,
): Promise<TProbeResult> => {
  try {
    return await withTimeout(probe, ms);
  } catch {
    return "error";
  }
};

class ServiceHealth {
  private ready = true;

  /** Readiness turns 503 from now on (graceful shutdown, FEAT-03). */
  markNotReady() {
    this.ready = false;
  }

  markReady() {
    this.ready = true;
  }

  isReady() {
    return this.ready;
  }

  /** Runs every probe with a timeout (default 2 s) and aggregates them. */
  async readiness(probes: IHealthProbes, timeoutMs = 2000): Promise<IReadiness> {
    const [db, redis, storage] = await Promise.all([
      settle(async () => {
        await probes.db();
        return "ok";
      }, timeoutMs),
      settle(probes.redis, timeoutMs),
      settle(probes.storage, timeoutMs),
    ]);

    const checks = { db: db === "ok" ? ("ok" as const) : ("error" as const), redis, storage };
    if (!this.ready) {
      return { status: "error", reason: "shutting_down", checks };
    }
    const failing = Object.values(checks).includes("error");
    return { status: failing ? "error" : "ok", checks };
  }
}

export default new ServiceHealth();
