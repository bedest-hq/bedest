import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  spyOn,
  expect,
  beforeAll,
} from "bun:test";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

import { TEnv } from "../types/TEnv";
import { STenant } from "@f/tenant/schemas/STenant";
import { ETenantPlan } from "@/features/tenant/enums/ETenantPlan";
import { SUser } from "@f/user/schemas/SUser";
import { EUserRole } from "@/features/user/enums/EUserRole";
import Elysia from "elysia";
import jwt from "@elysiajs/jwt";
import { password } from "bun";
import { SSession } from "@f/session/schemas/SSession";

const EnvManager = await import("@/infrastructure/env/EnvManager");
const DbManager = await import("@/infrastructure/database/DbManager");

interface CustomMatchers<R = unknown> {
  toBeApiError(expected: string): R;
  toBeApiOk(): R;
}

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T> extends CustomMatchers<T> {}
}

expect.extend({
  toBeApiOk(received: unknown) {
    const isNot = this.isNot;
    const res = received as { error?: string };

    return {
      pass: res.error === undefined,
      message: () => (isNot ? "Response is ok" : "Response is not ok."),
      actual: res.error,
      expected: "OK",
    };
  },

  toBeApiError(received: unknown, expected: string) {
    const isNot = this.isNot;
    const res = received as { error?: string };

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
  REFRESH_KEY: "refresh-key",
  SECRET_KEY: "secret-key",
  PORT: 3000,

  BILLING_WEBHOOK_SECRET: "whsec_test_secret_123",

  TRUST_PROXY_HOPS: 0,
  RATE_LIMIT_LOGIN_PER_MIN: 5,
  RATE_LIMIT_LOGIN_IP_PER_MIN: 20,
  RATE_LIMIT_REFRESH_PER_MIN: 30,

  LOCAL_STORAGE_PATH: "./test_uploads",
  STORAGE_ALLOWED_TYPES: "image/jpeg,image/png,image/webp,application/pdf",
  STORAGE_MAX_BYTES: 5 * 1024 * 1024,
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "testkey",
  S3_SECRET_KEY: "testsecret",
  S3_BUCKET: "test-bucket",
};

const test_client = new PGlite();
const test_db = drizzle(test_client);

spyOn(EnvManager.default, "get").mockReturnValue(test_env);
spyOn(DbManager.default, "get").mockReturnValue(
  test_db as unknown as NodePgDatabase,
);

// Imported after the spies: they pull in modules that read the env on import.
const RateLimitManager = await import(
  "@/infrastructure/ratelimit/RateLimitManager"
);
const ServiceSession = await import("@f/session/services/ServiceSession");

const test_signer = new Elysia().use(
  jwt({
    name: "accessJwt",
    secret: test_env.SECRET_KEY,
    exp: "15m",
  }),
);

export let test_tenant: typeof STenant.$inferSelect;
export let test_user: typeof SUser.$inferSelect;
export { test_db, test_env };

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
  const datetimeNow = new Date();
  const datetimeNextYear = new Date();
  datetimeNextYear.setFullYear(datetimeNow.getFullYear() + 1);

  const [insertedTenant] = await test_db
    .insert(STenant)
    .values({
      name: "Test Tenant",
      domain: "test.com",
      country: "Test Country",
      email: "test@example.com",
      phones: ["05555555555"],
      plan: ETenantPlan.PROFESSIONAL,
      planStart: datetimeNow,
      planEnd: datetimeNextYear,
    })
    .returning();

  test_tenant = insertedTenant;

  const [insertedUser] = await test_db
    .insert(SUser)
    .values({
      name: "Test User",
      email: "text@example.com",
      tenantId: test_tenant.id,
      password: pass,
      role: EUserRole.SYSTEM,
      createdAt: new Date(),
    })
    .returning();

  test_user = insertedUser;
});

afterEach(async () => {
  await RateLimitManager.default.resetAll();
  ServiceSession.default.clearCache();
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
});
