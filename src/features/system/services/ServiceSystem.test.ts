import { describe, it, expect } from "bun:test";
import DbManager from "@/infrastructure/database/DbManager";
import { ServiceSystem } from "./ServiceSystem";

const ctx = () => ({ db: DbManager.get(), nowDatetime: new Date() });

describe("BUG-08: maintenance mode", () => {
  it("[BUG-08] two instances sharing the database agree (after the 5 s cache)", async () => {
    let now = 0;
    const clock = () => now;
    const nodeA = new ServiceSystem(5000, clock);
    const nodeB = new ServiceSystem(5000, clock);

    expect(await nodeB.getMaintenance(ctx())).toBe(false);
    await nodeA.setMaintenance(ctx(), true);

    // The writer sees it at once; another node within its cache window may not.
    expect(await nodeA.getMaintenance(ctx())).toBe(true);
    now += 5001;
    expect(await nodeB.getMaintenance(ctx())).toBe(true);

    await nodeB.setMaintenance(ctx(), false);
    now += 5001;
    expect(await nodeA.getMaintenance(ctx())).toBe(false);
  });

  it("[BUG-08] an invalidation clears the cache immediately", async () => {
    const now = 0;
    const nodeA = new ServiceSystem(5000, () => now);
    const nodeB = new ServiceSystem(5000, () => now);
    expect(await nodeB.getMaintenance(ctx())).toBe(false);
    await nodeA.setMaintenance(ctx(), true);
    nodeB.invalidate();
    expect(await nodeB.getMaintenance(ctx())).toBe(true);
    await nodeA.setMaintenance(ctx(), false);
  });
});
