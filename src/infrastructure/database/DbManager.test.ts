import { describe, it, expect } from "bun:test";
import { test_env, test_runtime_db } from "@/common/tests/TestManager.test";
import DbManager, { lockOnClient, type ILockClient } from "./DbManager";

/** A pooled connection stand-in that records what happens to it. */
const fakeClient = (locked: boolean | Error) => {
  const calls: string[] = [];
  const client: ILockClient = {
    query: (text) => {
      calls.push(text.includes("unlock") ? "unlock" : "lock");
      if (locked instanceof Error) {
        return Promise.reject(locked);
      }
      return Promise.resolve({
        rows: [text.includes("unlock") ? { unlocked: true } : { locked }],
      });
    },
    release: () => {
      calls.push("release");
    },
  };
  return { client, calls };
};

describe("DbManager", () => {
  it("[FEAT-08] lockOnClient holds the connection until the job's release, then unlocks and returns it", async () => {
    const { client, calls } = fakeClient(true);
    const release = await lockOnClient(client, "job.a");
    expect(calls).toEqual(["lock"]);
    await release?.();
    expect(calls).toEqual(["lock", "unlock", "release"]);
  });

  it("[FEAT-08] a lock taken elsewhere returns the connection at once (null)", async () => {
    const { client, calls } = fakeClient(false);
    expect(await lockOnClient(client, "job.a")).toBeNull();
    expect(calls).toEqual(["lock", "release"]);
  });

  it("[FEAT-08] a failing lock query returns the connection and rethrows", async () => {
    const { client, calls } = fakeClient(new Error("connection reset"));
    const err = await lockOnClient(client, "job.a").then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(err)).toContain("connection reset");
    expect(calls).toEqual(["lock", "release"]);
  });

  it("[QLT-01] init builds a pool from the env (no connection until a query); connect gives a separate pool; shutdown ends it", async () => {
    try {
      DbManager.init(test_env);
      expect(DbManager.get()).not.toBe(test_runtime_db);
      const owner = DbManager.connect(test_env, {
        user: "owner",
        password: "owner-password",
      });
      expect(typeof owner.db.execute).toBe("function");
      await owner.end();
      await DbManager.shutdown();
    } finally {
      DbManager.use(test_runtime_db);
    }
    expect(DbManager.get()).toBe(test_runtime_db);
  });
});
