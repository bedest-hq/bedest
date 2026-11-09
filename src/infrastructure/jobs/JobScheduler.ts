import type { IApp, TDb } from "bedest-core";

/** A periodic background job [FEAT-08]. */
export interface IJob {
  name: string;
  intervalMs: number;
  run(c: IApp): Promise<unknown>;
}

export type TJobOutcome =
  | { status: "done"; result: unknown }
  | { status: "skipped" }
  | { status: "failed"; error: unknown };

/** Takes a cluster-wide lock; returns its release, or null when held elsewhere. */
export type TJobLock = (name: string) => Promise<(() => Promise<void>) | null>;

/** A query on ONE connection (session advisory locks are per connection). */
export type TLockQuery = (
  text: string,
  params: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * pg_try_advisory_lock(hashtext(name)) on the given connection; the release
 * runs pg_advisory_unlock on the same connection [FEAT-08].
 */
export const tryAdvisoryLock = async (query: TLockQuery, name: string) => {
  const res = await query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
    [name],
  );
  if (res.rows[0]?.locked !== true) {
    return null;
  }
  return async () => {
    await query("SELECT pg_advisory_unlock(hashtext($1))", [name]);
  };
};

export interface IJobSchedulerDeps {
  db: () => TDb;
  lock: TJobLock;
  now?: () => Date;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every?: (fn: () => void, ms: number) => () => void;
  onError?: (job: string, error: unknown) => void;
  /** Longest stop() waits for running jobs (default 10 s, FEAT-03). */
  stopTimeoutMs?: number;
}

const defaultEvery = (fn: () => void, ms: number) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

/**
 * Runs registered jobs periodically [FEAT-08]. Each run first takes a lock
 * named after the job, so with several nodes only one executes it; errors
 * are reported with the job name and never stop the scheduler. Tests
 * construct it explicitly and call runOnce.
 */
export class JobScheduler {
  private readonly jobs = new Map<string, IJob>();
  private readonly running = new Set<Promise<TJobOutcome>>();
  private stops: Array<() => void> = [];
  private readonly now: () => Date;
  private readonly every: (fn: () => void, ms: number) => () => void;

  constructor(private readonly deps: IJobSchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.every = deps.every ?? defaultEvery;
  }

  register(job: IJob) {
    if (this.jobs.has(job.name)) {
      throw new Error(`Job ${job.name} is already registered`);
    }
    this.jobs.set(job.name, job);
    return this;
  }

  names() {
    return [...this.jobs.keys()];
  }

  /** Schedules every registered job at its interval. */
  start() {
    for (const job of this.jobs.values()) {
      this.stops.push(
        this.every(() => {
          void this.runOnce(job.name);
        }, job.intervalMs),
      );
    }
  }

  /** Runs one job now (unless another node holds its lock). */
  runOnce(name: string): Promise<TJobOutcome> {
    const job = this.jobs.get(name);
    if (!job) {
      return Promise.reject(new Error(`Unknown job ${name}`));
    }
    const run = this.execute(job);
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
    return run;
  }

  private async execute(job: IJob): Promise<TJobOutcome> {
    let release: (() => Promise<void>) | null = null;
    try {
      release = await this.deps.lock(job.name);
      if (!release) {
        return { status: "skipped" };
      }
      const result = await job.run({
        db: this.deps.db(),
        nowDatetime: this.now(),
      });
      return { status: "done", result };
    } catch (error) {
      this.deps.onError?.(job.name, error);
      return { status: "failed", error };
    } finally {
      if (release) {
        await release().catch((error: unknown) =>
          this.deps.onError?.(job.name, error),
        );
      }
    }
  }

  /**
   * Stops scheduling and waits for running jobs, at most stopTimeoutMs
   * (graceful shutdown, FEAT-03). Idempotent.
   */
  async stop() {
    for (const stop of this.stops) {
      stop();
    }
    this.stops = [];
    if (this.running.size === 0) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.deps.stopTimeoutMs ?? 10_000);
    });
    await Promise.race([Promise.allSettled([...this.running]), timeout]);
    clearTimeout(timer);
  }
}
