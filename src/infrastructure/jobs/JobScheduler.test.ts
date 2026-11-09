import { describe, it, expect, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { test_runtime_db } from "@/common/tests/TestManager.test";
import { JobScheduler, tryAdvisoryLock, type IJob } from "./JobScheduler";

const NOW = new Date("2026-06-01T00:00:00Z");

/** A lock that is always free; records acquire/release. */
const freeLock = () => {
  const events: string[] = [];
  const lock = (name: string) => {
    events.push(`lock:${name}`);
    return Promise.resolve(() => {
      events.push(`release:${name}`);
      return Promise.resolve();
    });
  };
  return { lock, events };
};

const scheduler = (lock = freeLock().lock, extra = {}) =>
  new JobScheduler({
    db: () => test_runtime_db,
    lock,
    now: () => NOW,
    ...extra,
  });

const job = (name: string, run: IJob["run"], intervalMs = 1000): IJob => ({
  name,
  intervalMs,
  run,
});

describe("FEAT-08: JobScheduler", () => {
  it("[FEAT-08] runOnce runs the job with the database and the clock, under its lock", async () => {
    const { lock, events } = freeLock();
    const run = mock((c: { nowDatetime: Date }) =>
      Promise.resolve(c.nowDatetime.toISOString()),
    );
    const s = scheduler(lock).register(job("a", run));

    expect(await s.runOnce("a")).toEqual({
      status: "done",
      result: NOW.toISOString(),
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["lock:a", "release:a"]);
  });

  it("[FEAT-08] a job whose lock is held elsewhere is skipped", async () => {
    const run = mock(() => Promise.resolve());
    const s = scheduler(() => Promise.resolve(null)).register(job("a", run));
    expect(await s.runOnce("a")).toEqual({ status: "skipped" });
    expect(run).not.toHaveBeenCalled();
  });

  it("[FEAT-08] errors are reported with the job name and the lock is still released", async () => {
    const { lock, events } = freeLock();
    const failures: string[] = [];
    const onError = mock((name: string) => {
      failures.push(name);
    });
    const s = scheduler(lock, { onError }).register(
      job("boom", () => Promise.reject(new Error("db down"))),
    );
    const outcome = await s.runOnce("boom");
    expect(outcome.status).toBe("failed");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(failures).toEqual(["boom"]);
    expect(events).toEqual(["lock:boom", "release:boom"]);
  });

  it("[FEAT-08] start schedules every job at its interval", async () => {
    const intervals: number[] = [];
    const ticks: Array<() => void> = [];
    const run = mock(() => Promise.resolve());
    const s = scheduler(freeLock().lock, {
      every: (fn: () => void, ms: number) => {
        intervals.push(ms);
        ticks.push(fn);
        return () => undefined;
      },
    })
      .register(job("hourly", run, 3_600_000))
      .register(job("daily", run, 86_400_000));

    s.start();
    expect(intervals).toEqual([3_600_000, 86_400_000]);
    ticks[0]?.();
    await s.stop();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("[FEAT-08][FEAT-03] stop waits for a running job", async () => {
    let finish: () => void = () => undefined;
    const done = mock(() => undefined);
    const s = scheduler().register(
      job(
        "slow",
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              done();
              resolve();
            };
          }),
      ),
    );
    const outcome = s.runOnce("slow");
    const stopped = s.stop();
    await Bun.sleep(5);
    finish();
    await stopped;
    expect(done).toHaveBeenCalledTimes(1);
    expect((await outcome).status).toBe("done");
  });

  it("[FEAT-08][FEAT-03] stop gives up after stopTimeoutMs when a job hangs", async () => {
    const s = scheduler(freeLock().lock, { stopTimeoutMs: 20 }).register(
      job("hang", () => new Promise(() => undefined)),
    );
    void s.runOnce("hang");
    const started = Date.now();
    await s.stop();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("[FEAT-08] tryAdvisoryLock takes and releases a Postgres advisory lock", async () => {
    const pg = new PGlite();
    try {
      const query = (text: string, params: unknown[]) =>
        pg.query<Record<string, unknown>>(text, params);
      const release = await tryAdvisoryLock(query, "jobs.test");
      expect(release).not.toBeNull();
      const held = await pg.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'",
      );
      expect(held.rows[0]?.n).toBe(1);
      await release?.();
      const after = await pg.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'",
      );
      expect(after.rows[0]?.n).toBe(0);
    } finally {
      await pg.close();
    }
  });

  it("[FEAT-08] tryAdvisoryLock returns null when Postgres reports the lock as taken", async () => {
    const query = () => Promise.resolve({ rows: [{ locked: false }] });
    expect(await tryAdvisoryLock(query, "jobs.test")).toBeNull();
  });
});
