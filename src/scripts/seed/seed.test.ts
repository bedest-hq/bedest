import { describe, it, expect, beforeEach } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { test_db } from "@/common/tests/TestManager.test";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import EnvManager from "@/infrastructure/env/EnvManager";
import { runSeed, VSeedEnv } from "./seed";
import DbManager from "@/infrastructure/database/DbManager";

const db = DbManager.get();

const systemUsers = () =>
  test_db
    .select({ id: SUser.id, email: SUser.email, password: SUser.password })
    .from(SUser)
    .where(and(eq(SUser.role, EUserRole.SYSTEM), eq(SUser.isDeleted, false)));

describe("seed", () => {
  beforeEach(async () => {
    // Start from an empty database: the shared fixtures create a SYSTEM user.
    await test_db.execute(sql`TRUNCATE TABLE users, tenants CASCADE`);
  });

  it("[SEC-03] seeding twice creates exactly one SYSTEM user; the second run is a no-op", async () => {
    const lines: string[] = [];
    const opts = {
      nodeEnv: "development" as const,
      seedEnv: {
        SEED_SYSTEM_EMAIL: "owner@example.com",
        SEED_SYSTEM_PASSWORD: "a-strong-seed-password",
      },
      print: (line: string) => lines.push(line),
    };

    const first = await runSeed(db, opts);
    const second = await runSeed(db, opts);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const users = await systemUsers();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("owner@example.com");
    expect(
      await Bun.password.verify("a-strong-seed-password", users[0].password),
    ).toBe(true);
    // A provided password is never echoed.
    expect(lines.join("\n")).not.toContain("a-strong-seed-password");
  });

  it("[SEC-03] without SEED_SYSTEM_PASSWORD a random 24-char password is generated and printed once", async () => {
    const lines: string[] = [];
    const res = await runSeed(db, {
      nodeEnv: "development",
      seedEnv: { SEED_SYSTEM_EMAIL: "owner@example.com" },
      print: (line) => lines.push(line),
    });

    expect(res.generatedPassword).toBeDefined();
    const generated = res.generatedPassword ?? "";
    expect(generated).toHaveLength(24);
    expect(lines.filter((l) => l.includes(generated))).toHaveLength(1);
    expect(lines.join("\n")).toMatch(/change/i);

    const [user] = await systemUsers();
    expect(await Bun.password.verify(generated, user.password)).toBe(true);
    expect(await Bun.password.verify("Password", user.password)).toBe(false);
  });

  it("[SEC-03] refuses to run in production unless ALLOW_PRODUCTION_SEED=true", async () => {
    const seedEnv = {
      SEED_SYSTEM_EMAIL: "owner@example.com",
      SEED_SYSTEM_PASSWORD: "a-strong-seed-password",
    };

    const refused = await runSeed(db, {
      nodeEnv: "production",
      seedEnv,
      print: () => {},
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(refused).toBeInstanceOf(Error);
    expect(String(refused)).toMatch(/ALLOW_PRODUCTION_SEED/);
    expect(await systemUsers()).toHaveLength(0);

    const allowed = await runSeed(db, {
      nodeEnv: "production",
      seedEnv: { ...seedEnv, ALLOW_PRODUCTION_SEED: true },
      print: () => {},
    });
    expect(allowed.created).toBe(true);
  });

  it("[SEC-03] SEED_SYSTEM_EMAIL is required and must be an e-mail address", () => {
    expect(() => EnvManager.parseScript(VSeedEnv, {})).toThrow(
      /SEED_SYSTEM_EMAIL/,
    );
    expect(() =>
      EnvManager.parseScript(VSeedEnv, { SEED_SYSTEM_EMAIL: "not-an-email" }),
    ).toThrow(/SEED_SYSTEM_EMAIL/);
    expect(
      EnvManager.parseScript(VSeedEnv, {
        SEED_SYSTEM_EMAIL: "owner@example.com",
        ALLOW_PRODUCTION_SEED: "true",
      }),
    ).toEqual({
      SEED_SYSTEM_EMAIL: "owner@example.com",
      ALLOW_PRODUCTION_SEED: true,
    });
  });
});
