export interface IShutdownStep {
  name: string;
  run: () => Promise<unknown> | unknown;
  /** Optional budget for this step; it is abandoned (and logged) after it. */
  timeoutMs?: number;
}

export interface IShutdownOptions {
  /** Executed in order; a failing step never prevents the next ones. */
  steps: IShutdownStep[];
  /** Hard deadline for the whole shutdown (SHUTDOWN_TIMEOUT_MS). */
  timeoutMs: number;
  exit: (code: number) => void;
  log: (level: "info" | "error", message: string, err?: unknown) => void;
}

const withTimeout = async (step: IShutdownStep, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(step.run()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${step.name} did not finish within ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Graceful shutdown [FEAT-03][OPS-08]. Returns an idempotent handler for
 * SIGTERM/SIGINT: the steps run once, in order; the process exits 0 when
 * all succeeded, 1 when one failed, and is force-exited with 1 after
 * `timeoutMs`.
 */
export function createShutdown(opts: IShutdownOptions) {
  let running: Promise<void> | undefined;

  return (signal: string): Promise<void> => {
    if (running) {
      return running;
    }

    running = (async () => {
      opts.log("info", `Received ${signal}; shutting down gracefully.`);

      const deadline = setTimeout(() => {
        opts.log("error", `Shutdown timed out after ${opts.timeoutMs} ms; forcing exit.`);
        opts.exit(1);
      }, opts.timeoutMs);
      // The deadline must never keep an otherwise finished process alive.
      deadline.unref?.();

      let failed = false;
      for (const step of opts.steps) {
        try {
          if (step.timeoutMs !== undefined) {
            await withTimeout(step, step.timeoutMs);
          } else {
            await step.run();
          }
        } catch (err) {
          failed = true;
          opts.log("error", `Shutdown step "${step.name}" failed.`, err);
        }
      }

      clearTimeout(deadline);
      opts.exit(failed ? 1 : 0);
    })();

    return running;
  };
}
