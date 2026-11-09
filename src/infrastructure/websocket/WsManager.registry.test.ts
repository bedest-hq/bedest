import { describe, it, expect } from "bun:test";
import { WsManager, IWsClient } from "./WsManager";

/**
 * Elysia hands every WebSocket event a NEW wrapper object around the same
 * connection; only `id` is stable. `wrapper()` builds such wrappers.
 */
const connection = (id = crypto.randomUUID()) => {
  const closed: Array<[number | undefined, string | undefined]> = [];
  const sent: unknown[] = [];
  const wrapper = (): IWsClient => ({
    id,
    send: (data) => {
      sent.push(data);
    },
    close: (code, reason) => {
      closed.push([code, reason]);
    },
  });
  return { id, wrapper, closed, sent };
};

const HOUR = 60 * 60 * 1000;

const setup = (start = 1_000_000) => {
  let now = start;
  let sweep: (() => void) | null = null;
  let sweepEveryMs = 0;
  const manager = new WsManager({
    now: () => now,
    every: (fn, ms) => {
      sweep = fn;
      sweepEveryMs = ms;
      return () => {
        sweep = null;
      };
    },
  });
  return {
    manager,
    advance: (ms: number) => {
      now += ms;
    },
    runSweep: () => sweep?.(),
    sweepEveryMs: () => sweepEveryMs,
    now: () => now,
  };
};

describe("BUG-10: one registry keyed by connection", () => {
  it("[BUG-10] closing through another wrapper of the same connection removes it from every index", () => {
    const { manager, now } = setup();
    const c = connection();
    manager.registerClient(c.wrapper(), { userId: "u1", sessionId: "s1", expiresAt: now() + HOUR });

    manager.unregisterClient(c.wrapper());

    expect(manager.stats()).toEqual({ clients: 0, users: 0, sessions: 0 });
    manager.disconnectUser("u1");
    manager.disconnectSession("s1");
    expect(c.closed).toEqual([]);
  });

  it("[BUG-10] disconnecting a session also drops the socket from the user index (no second close)", () => {
    const { manager, now } = setup();
    const laptop = connection();
    const phone = connection();
    manager.registerClient(laptop.wrapper(), { userId: "u1", sessionId: "s1", expiresAt: now() + HOUR });
    manager.registerClient(phone.wrapper(), { userId: "u1", sessionId: "s2", expiresAt: now() + HOUR });

    manager.disconnectSession("s1");
    expect(laptop.closed).toEqual([[1008, "Session terminated"]]);
    expect(manager.stats()).toEqual({ clients: 1, users: 1, sessions: 1 });

    manager.disconnectUser("u1");
    expect(laptop.closed).toHaveLength(1);
    expect(phone.closed).toEqual([[1008, "Session terminated"]]);
    expect(manager.stats()).toEqual({ clients: 0, users: 0, sessions: 0 });
  });

  it("[BUG-10] disconnecting a user also drops its sockets from the session index", () => {
    const { manager, now } = setup();
    const c = connection();
    manager.registerClient(c.wrapper(), { userId: "u1", sessionId: "s1", expiresAt: now() + HOUR });

    manager.disconnectUser("u1");
    manager.disconnectSession("s1");

    expect(c.closed).toHaveLength(1);
    expect(manager.stats()).toEqual({ clients: 0, users: 0, sessions: 0 });
  });
});

describe("BUG-10: sockets do not outlive their access token", () => {
  it("[BUG-10] init schedules a sweep every 30 s", () => {
    const { manager, sweepEveryMs } = setup();
    manager.init({ publish: () => undefined });
    expect(sweepEveryMs()).toBe(30_000);
    manager.closeAll();
  });

  it("[BUG-10] the sweep closes sockets whose token expired with 4001 and keeps the others", () => {
    const { manager, advance, runSweep, now } = setup();
    manager.init({ publish: () => undefined });
    const short = connection();
    const long = connection();
    manager.registerClient(short.wrapper(), { userId: "u1", sessionId: "s1", expiresAt: now() + 1_000 });
    manager.registerClient(long.wrapper(), { userId: "u2", sessionId: "s2", expiresAt: now() + HOUR });

    advance(999);
    runSweep();
    expect(short.closed).toEqual([]);

    advance(1);
    runSweep();
    expect(short.sent).toContainEqual({ event: "token_expired" });
    expect(short.closed).toEqual([[4001, "Token expired"]]);
    expect(long.closed).toEqual([]);
    expect(manager.stats()).toEqual({ clients: 1, users: 1, sessions: 1 });
    manager.closeAll();
  });

  it("[BUG-10] closeAll stops the sweep", () => {
    const { manager, runSweep, now, advance } = setup();
    manager.init({ publish: () => undefined });
    manager.closeAll();
    const c = connection();
    manager.registerClient(c.wrapper(), { userId: "u1", sessionId: "s1", expiresAt: now() });
    advance(HOUR);
    runSweep();
    expect(c.closed).toEqual([]);
  });
});
