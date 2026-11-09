import { describe, it, expect } from "bun:test";
import { WsManager, IWsClient } from "./WsManager";

const fakeSocket = () => {
  const closed: Array<[number | undefined, string | undefined]> = [];
  // The registry keys sockets by connection id [BUG-10].
  const ws: IWsClient = {
    id: crypto.randomUUID(),
    send: () => {},
    close: (code, reason) => {
      closed.push([code, reason]);
    },
  };
  return { ws, closed };
};

describe("WsManager", () => {
  it("[FEAT-03] closeAll closes every socket once with 1001 and empties the registry", () => {
    const manager = new WsManager();
    const a = fakeSocket();
    const b = fakeSocket();
    manager.registerClient(a.ws, { userId: "u1", sessionId: "s1", expiresAt: Date.now() + 60_000 });
    manager.registerClient(b.ws, { userId: "u2", sessionId: "s2", expiresAt: Date.now() + 60_000 });

    manager.closeAll();

    expect(a.closed).toEqual([[1001, "Server shutting down"]]);
    expect(b.closed).toEqual([[1001, "Server shutting down"]]);
    manager.closeAll();
    expect(a.closed).toHaveLength(1);
  });
});
