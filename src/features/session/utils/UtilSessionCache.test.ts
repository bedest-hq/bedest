import { describe, it, expect } from "bun:test";
import { UtilSessionCache } from "./UtilSessionCache";

describe("UtilSessionCache", () => {
  it("[SEC-08] entries expire after the TTL so other nodes' revocations are seen", () => {
    const cache = new UtilSessionCache(30_000);
    cache.set("s1", 0, Number.MAX_SAFE_INTEGER);
    expect(cache.has("s1", 29_999)).toBe(true);
    expect(cache.has("s1", 30_000)).toBe(false);
  });

  it("[SEC-08] an entry never outlives the session itself", () => {
    const cache = new UtilSessionCache(30_000);
    cache.set("s1", 0, 5_000);
    expect(cache.has("s1", 4_999)).toBe(true);
    expect(cache.has("s1", 5_000)).toBe(false);
  });

  it("[SEC-08] delete() invalidates immediately and the size is bounded (LRU)", () => {
    const cache = new UtilSessionCache(30_000, 2);
    cache.set("a", 0, 1e9);
    cache.set("b", 0, 1e9);
    expect(cache.has("a", 1)).toBe(true); // "a" becomes most recent
    cache.set("c", 0, 1e9); // evicts "b"
    expect(cache.has("b", 1)).toBe(false);
    expect(cache.has("a", 1)).toBe(true);
    cache.delete("a");
    expect(cache.has("a", 1)).toBe(false);
  });
});
