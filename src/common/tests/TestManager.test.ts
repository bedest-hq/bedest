import { PGlite, type Transaction } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, beforeAll } from "bun:test";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import { TEnv } from "../types/TEnv";
import { STenant } from "@f/tenant/schemas/STenant";
import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@/features/user/enums/EUserRole";
import Elysia from "elysia";
import jwt from "@elysiajs/jwt";
import { password } from "bun";
import { rm } from "node:fs/promises";
import { SSession } from "@f/session/schemas/SSession";
import { JWT_AUDIENCE } from "@f/auth/validations/VJwtPayload";

import EnvManager from "@/infrastructure/env/EnvManager";
import DbManager from "@/infrastructure/database/DbManager";
import RateLimitManager from "@/infrastructure/ratelimit/RateLimitManager";
import ServiceSession from "@f/session/services/ServiceSession";
import ServiceSystem from "@f/system/services/ServiceSystem";

// Custom matchers, merged into bun:test (members declared directly, so no
// empty interface is needed).
declare module "bun:test" {
  interface Matchers<T> {
    toBeApiError(expected: string): T;
    toBeApiOk(): T;
  }
}

// The error envelope { error, message?, details? } [BUG-14].
const envelopeError = (received: unknown): string | undefined =>
  typeof received === "object" &&
  received !== null &&
  "error" in received &&
  typeof received.error === "string"
    ? received.error
    : undefined;

expect.extend({
  toBeApiOk(received: unknown) {
    const isNot = this.isNot;
    const res = { error: envelopeError(received) };

    return {
      pass: res.error === undefined,
      message: () => (isNot ? "Response is ok" : "Response is not ok."),
      actual: res.error,
      expected: "OK",
    };
  },

  toBeApiError(received: unknown, expected: string) {
    const isNot = this.isNot;
    const res = { error: envelopeError(received) };

    return {
      pass: res.error !== undefined && res.error === expected,
      message: () =>
        res.error === undefined
          ? isNot
            ? "Response is failed"
            : "Response is not failed."
          : isNot
            ? "Fail code matches."
            : "Fail code mismatch.",
      actual: res.error === undefined ? "OK" : res.error,
      expected,
    };
  },
});

const test_env: TEnv = {
  NODE_ENV: "test",
  CORS_ORIGINS: "http://localhost:3000",
  DATABASE_HOST: "test_host",
  DATABASE_NAME: "test_name",
  DATABASE_PASSWORD: "test_password",
  DATABASE_PORT: 3000,
  DATABASE_USER: "test_user",
  REFRESH_KEY: "test-refresh-key-at-least-32-characters-long",
  JWT_ISSUER: "bedest",
  SECRET_KEY: "test-access-key-at-least-32-characters-long",
  PORT: 3000,
  MAX_REQUEST_BODY_BYTES: 10 * 1024 * 1024,
  SHUTDOWN_TIMEOUT_MS: 15000,
  // Tests construct the JobScheduler explicitly [FEAT-08].
  JOBS_ENABLED: false,
  STORAGE_PURGE_AFTER_DAYS: 30,
  NOTIFICATION_RETENTION_DAYS: 180,

  BILLING_WEBHOOK_SECRET: "whsec_test_secret_123",

  TRUST_PROXY_HOPS: 0,
  RATE_LIMIT_LOGIN_PER_MIN: 5,
  RATE_LIMIT_LOGIN_IP_PER_MIN: 20,
  RATE_LIMIT_REFRESH_PER_MIN: 30,
  RATE_LIMIT_TENANT_RESOLVE_PER_MIN: 30,
  RATE_LIMIT_PASSWORD_FORGOT_PER_MIN: 5,
  RATE_LIMIT_PASSWORD_FORGOT_PER_HOUR: 3,

  // Nothing is delivered; tests read the in-memory messages [FEAT-06].
  MAIL_PROVIDER: "console",
  APP_PUBLIC_URL: "http://localhost:5173",
  SMTP_SECURE: false,

  LOCAL_STORAGE_PATH: "./test_uploads",
  STORAGE_ALLOWED_TYPES: "image/jpeg,image/png,image/webp,application/pdf",
  STORAGE_MAX_BYTES: 5 * 1024 * 1024,
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "testkey",
  S3_SECRET_KEY: "testsecret",
  S3_BUCKET: "test-bucket",
  S3_FORCE_PATH_STYLE: true,
};

const test_client = new PGlite();
/** Superuser connection: migrations, fixtures and assertions only. */
const test_db = drizzle(test_client);

/**
 * The application's connection [SEC-04]: every statement runs inside a
 * transaction as the non-privileged `bedest_app` role, exactly like the
 * production login, so RLS policies are really enforced in tests.
 */
const appClient = new Proxy(test_client, {
  get(target, prop) {
    if (prop === "query") {
      return (...args: Parameters<PGlite["query"]>) =>
        target.transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE bedest_app");
          return await tx.query(...args);
        });
    }
    if (prop === "transaction") {
      return <T>(fn: (tx: Transaction) => Promise<T>) =>
        target.transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE bedest_app");
          return await fn(tx);
        });
    }
    const value: unknown = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const test_app_db = drizzle({ client: appClient });

// drizzle's PGlite and node-postgres database types are not mutually
// assignable although the runtime API is the same (see CORE-10).
const asNodePg = (db: PgliteDatabase): NodePgDatabase =>
  db as unknown as NodePgDatabase;

/** Superuser handle typed like the app's database (for script functions). */
export const test_owner_db = asNodePg(test_db);

// Real initialization with test dependencies instead of spies: no module
// reads the environment or the database at import time [QLT-01].
EnvManager.init(
  Object.fromEntries(
    Object.entries(test_env)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ),
);
/** The application handle (runs as bedest_app, RLS enforced). */
export const test_runtime_db = asNodePg(test_app_db);
DbManager.use(test_runtime_db);

const test_signer = new Elysia().use(
  jwt({
    name: "accessJwt",
    secret: test_env.SECRET_KEY,
    iss: test_env.JWT_ISSUER,
    aud: JWT_AUDIENCE,
    exp: "15m",
  }),
);

export let test_tenant: typeof STenant.$inferSelect;
/** The default principal: a plain USER [TST-01]. */
export let test_user: typeof SUser.$inferSelect;
/** A SYSTEM user of the test tenant, for tests that need it explicitly. */
export let test_system_user: typeof SUser.$inferSelect;
export { test_db, test_env };

/** Headers of the SYSTEM test user (explicit opt-in) [TST-01]. */
export const testSystemHeaders = async () =>
  await testHeaders(test_system_user);

export const testHeaders = async (user = test_user) => {
  if (!user) {
    throw new Error("Test user is not initialized yet!");
  }

  // A real session row: the access path verifies that the session exists
  // [SEC-08].
  const [session] = await test_db
    .insert(SSession)
    .values({
      userId: user.id,
      tenantId: user.tenantId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: SSession.id });

  const token = await test_signer.decorator.accessJwt.sign({
    typ: "access",
    userId: user.id,
    tenantId: user.tenantId,
    sessionId: session.id,
    role: user.role,
  });

  return {
    Cookie: `accessToken=${token}`,
  };
};

let pass: string;

export const createTestUser = async (
  userRole = EUserRole.USER,
  tenant = test_tenant,
) => {
  const [createdUser] = await test_db
    .insert(SUser)
    .values({
      name: `Test User ${userRole}`,
      email: `user_${crypto.randomUUID().slice(0, 8)}@example.com`,
      tenantId: tenant.id,
      password: pass,
      role: userRole,
      createdAt: new Date(),
    })
    .returning();

  const headers = await testHeaders(createdUser);
  return { user: createdUser, headers, tenant };
};

export const createForeignTenant = async (userRole = EUserRole.USER) => {
  const datetimeNow = new Date();
  const datetimeNextYear = new Date();
  datetimeNextYear.setFullYear(datetimeNow.getFullYear() + 1);

  const [foreignTenant] = await test_db
    .insert(STenant)
    .values({
      name: "Foreign Tenant",
      domain: `foreign-${crypto.randomUUID().slice(0, 8)}.com`,
      country: "Foreign Country",
      email: `foreign-${crypto.randomUUID().slice(0, 8)}@example.com`,
      phones: ["05555555556"],
      plan: ETenantPlan.PROFESSIONAL,
      planStart: datetimeNow,
      planEnd: datetimeNextYear,
    })
    .returning();

  return await createTestUser(userRole, foreignTenant);
};

export const testUserHeaders = async (
  userRole = EUserRole.USER,
  tenant = test_tenant,
) => {
  const { headers } = await createTestUser(userRole, tenant);
  return headers;
};

export const testAdminHeaders = async (tenant = test_tenant) => {
  return await testUserHeaders(EUserRole.ADMIN, tenant);
};

export const testForeignTenantUserHeaders = async (
  userRole = EUserRole.USER,
) => {
  const { headers } = await createForeignTenant(userRole);
  return headers;
};

beforeAll(async () => {
  await migrate(test_db, { migrationsFolder: "drizzle" });
  pass = await password.hash("test_password");
});

beforeEach(async () => {
  // Unique per test: nothing may rely on fixed values [TST-06].
  const suffix = crypto.randomUUID().slice(0, 8);
  const datetimeNow = new Date();
  const datetimeNextYear = new Date();
  datetimeNextYear.setFullYear(datetimeNow.getFullYear() + 1);

  const [insertedTenant] = await test_db
    .insert(STenant)
    .values({
      name: "Test Tenant",
      domain: `test-${suffix}.example.com`,
      country: "Test Country",
      email: `tenant-${suffix}@example.com`,
      phones: ["05555555555"],
      plan: ETenantPlan.PROFESSIONAL,
      planStart: datetimeNow,
      planEnd: datetimeNextYear,
    })
    .returning();

  test_tenant = insertedTenant;

  const [insertedUser, insertedSystemUser] = await test_db
    .insert(SUser)
    .values([
      {
        name: "Test User",
        email: `user-${suffix}@example.com`,
        tenantId: test_tenant.id,
        password: pass,
        role: EUserRole.USER,
        createdAt: new Date(),
      },
      {
        name: "Test System User",
        email: `system-${suffix}@example.com`,
        tenantId: test_tenant.id,
        password: pass,
        role: EUserRole.SYSTEM,
        createdAt: new Date(),
      },
    ])
    .returning();

  test_user = insertedUser;
  test_system_user = insertedSystemUser;
});

afterEach(async () => {
  await RateLimitManager.resetAll();
  ServiceSession.clearCache();
  ServiceSystem.invalidate();
  await test_db.execute(sql`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE;';
      END LOOP;
    END $$;
  `);
});

afterAll(async () => {
  await test_client.close();
  // Local-provider files written during the run [TST-06].
  await rm("./test_uploads", { recursive: true, force: true });
});
