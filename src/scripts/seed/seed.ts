import { and, eq } from "drizzle-orm";
import { t } from "elysia";
import { TDb, UtilTenantScope } from "bedest-core";
import { TEnv } from "@/common/types/TEnv";
import { SYSTEM_TENANT_NAME, SYSTEM_USER_NAME } from "@/common/constants";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SUser } from "@f/user/schemas/SUser";
import { STenant } from "@f/tenant/schemas/STenant";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import EnvManager from "@/infrastructure/env/EnvManager";
import DbManager from "@/infrastructure/database/DbManager";
import { UtilSeedPassword } from "./UtilSeedPassword";

/** Script-only variables, validated here and never part of the server VEnv. */
export const VSeedEnv = t.Object({
  SEED_SYSTEM_EMAIL: t.String({ format: "email", maxLength: 254 }),
  SEED_SYSTEM_PASSWORD: t.Optional(t.String({ minLength: 12, maxLength: 128 })),
  ALLOW_PRODUCTION_SEED: t.Optional(t.Boolean()),
});

export interface ISeedOptions {
  nodeEnv: TEnv["NODE_ENV"];
  seedEnv: {
    SEED_SYSTEM_EMAIL: string;
    SEED_SYSTEM_PASSWORD?: string;
    ALLOW_PRODUCTION_SEED?: boolean;
  };
  /** Writes one line to the operator's terminal. */
  print: (line: string) => void;
  now?: Date;
}

export interface ISeedResult {
  created: boolean;
  generatedPassword?: string;
}

/**
 * Creates the System Tenant and its SYSTEM user. Idempotent: when an active
 * SYSTEM user already exists nothing is written.
 */
export async function runSeed(
  db: TDb,
  opts: ISeedOptions,
): Promise<ISeedResult> {
  if (
    opts.nodeEnv === "production" &&
    opts.seedEnv.ALLOW_PRODUCTION_SEED !== true
  ) {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. Set ALLOW_PRODUCTION_SEED=true to override.",
    );
  }

  const now = opts.now ?? new Date();
  const planEnd = new Date(now);
  planEnd.setFullYear(now.getFullYear() + 1);

  const generatedPassword = opts.seedEnv.SEED_SYSTEM_PASSWORD
    ? undefined
    : UtilSeedPassword.generate(24);
  const plainPassword = opts.seedEnv.SEED_SYSTEM_PASSWORD ?? generatedPassword;
  if (!plainPassword) {
    throw new Error("Unable to determine the SYSTEM user password.");
  }
  const passwordHash = await Bun.password.hash(plainPassword);
  const email = opts.seedEnv.SEED_SYSTEM_EMAIL;

  const created = await UtilTenantScope.systemScope(db, async (tx) => {
    const [existingSystemUser] = await tx
      .select({ id: SUser.id })
      .from(SUser)
      .where(and(eq(SUser.role, EUserRole.SYSTEM), eq(SUser.isDeleted, false)))
      .limit(1);

    if (existingSystemUser) {
      return false;
    }

    const [existingTenant] = await tx
      .select({ id: STenant.id })
      .from(STenant)
      .where(
        and(eq(STenant.name, SYSTEM_TENANT_NAME), eq(STenant.isDeleted, false)),
      )
      .limit(1);

    const tenantId =
      existingTenant?.id ??
      (
        await tx
          .insert(STenant)
          .values({
            name: SYSTEM_TENANT_NAME,
            country: "Turkey",
            domain: "bedest.com",
            phones: ["xxx-xxx-xxx-xxxx"],
            links: [],
            email,
            plan: ETenantPlan.PROFESSIONAL,
            planStart: now,
            planEnd,
            createdAt: now,
          })
          .returning({ id: STenant.id })
      )[0]?.id;

    if (!tenantId) {
      throw new Error("Failed to create the System Tenant.");
    }

    await tx.insert(SUser).values({
      tenantId,
      name: SYSTEM_USER_NAME,
      email,
      password: passwordHash,
      role: EUserRole.SYSTEM,
      createdAt: now,
    });

    return true;
  });

  if (!created) {
    opts.print("SYSTEM user already exists; nothing to seed.");
    return { created: false };
  }

  opts.print(`SYSTEM user created: ${email}`);
  if (generatedPassword) {
    opts.print(
      `WARNING: generated SYSTEM password (shown once, change it after the first login): ${generatedPassword}`,
    );
  }
  return { created: true, generatedPassword };
}

async function main() {
  const env = EnvManager.init();
  const seedEnv = EnvManager.parseScript(VSeedEnv);
  DbManager.init(env);
  try {
    await runSeed(DbManager.get(), {
      nodeEnv: env.NODE_ENV,
      seedEnv,
      print: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await DbManager.shutdown();
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(
      `Seed failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
