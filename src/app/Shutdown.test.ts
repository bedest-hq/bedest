import { describe, it, expect } from "bun:test";
import { createShutdown, IShutdownStep } from "./Shutdown";

const harness = (steps: IShutdownStep[], timeoutMs = 1000) => {
  const exits: number[] = [];
  const logs: string[] = [];
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const shutdown = createShutdown({
    steps,
    timeoutMs,
    exit: (code) => {
      exits.push(code);
      resolveExit(code);
    },
    log: (level, message) => logs.push(`${level}: ${message}`),
  });
  return { shutdown, exits, logs, exited };
};

describe("Shutdown", () => {
  it("[FEAT-03][OPS-08] runs every step in order and exits 0", async () => {
    const calls: string[] = [];
    const step = (name: string): IShutdownStep => ({
      name,
      run: () => {
        calls.push(name);
      },
    });
    const h = harness([
      step("markNotReady"),
      step("stopServer"),
      step("closeWebSockets"),
      step("closeRedis"),
      step("closeDb"),
      step("flushLogger"),
    ]);

    await h.shutdown("SIGTERM");
    expect(calls).toEqual([
      "markNotReady",
      "stopServer",
      "closeWebSockets",
      "closeRedis",
      "closeDb",
      "flushLogger",
    ]);
    expect(h.exits).toEqual([0]);
  });

  it("[FEAT-03] is idempotent when the signal arrives twice", async () => {
    let runs = 0;
    const h = harness([{ name: "closeDb", run: () => void runs++ }]);
    const first = h.shutdown("SIGTERM");
    const second = h.shutdown("SIGINT");
    expect(second).toBe(first);
    await first;
    expect(runs).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it("[FEAT-03] a failing step is logged, the remaining steps still run, exit code 1", async () => {
    const calls: string[] = [];
    const h = harness([
      {
        name: "closeRedis",
        run: () => {
          throw new Error("redis gone");
        },
      },
      { name: "closeDb", run: () => void calls.push("closeDb") },
    ]);
    await h.shutdown("SIGTERM");
    expect(calls).toEqual(["closeDb"]);
    expect(h.logs.some((l) => l.startsWith("error:") && l.includes("closeRedis"))).toBe(true);
    expect(h.exits).toEqual([1]);
  });

  it("[FEAT-03] a step with its own budget (e.g. running jobs) is abandoned after it", async () => {
    const calls: string[] = [];
    const h = harness([
      { name: "stopJobs", timeoutMs: 10, run: () => new Promise(() => {}) },
      { name: "closeDb", run: () => void calls.push("closeDb") },
    ]);
    await h.shutdown("SIGTERM");
    expect(calls).toEqual(["closeDb"]);
    expect(h.exits).toEqual([1]);
  });

  it("[FEAT-03] hard-exits with code 1 after SHUTDOWN_TIMEOUT_MS when a step hangs", async () => {
    const h = harness([{ name: "stopServer", run: () => new Promise(() => {}) }], 20);
    void h.shutdown("SIGTERM");
    expect(await h.exited).toBe(1);
    expect(h.logs.some((l) => l.includes("timed out"))).toBe(true);
  });
});
