import { describe, it, expect } from "bun:test";
import { WsManager, IWsClient } from "./WsManager";

const fakeSocket = () => {
  const closed: Array<[number | undefined, string | undefined]> = [];
  const ws: IWsClient = {
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
    manager.registerClient("u1", a.ws, "s1");
    manager.registerClient("u2", b.ws, "s2");

    manager.closeAll();

    expect(a.closed).toEqual([[1001, "Server shutting down"]]);
    expect(b.closed).toEqual([[1001, "Server shutting down"]]);
    manager.closeAll();
    expect(a.closed).toHaveLength(1);
  });
});
