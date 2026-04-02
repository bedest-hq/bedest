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
import { EXAMPLE_UUID } from "../constants";

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
  CORS_ORIGIN: "http://localhost:3000",
  DATABASE_HOST: "test_host",
  DATABASE_NAME: "test_name",
  DATABASE_PASSWORD: "test_password",
  DATABASE_PORT: 3000,
  DATABASE_USER: "test_user",
  REFRESH_KEY: "refresh-key",
  SECRET_KEY: "secret-key",
  PORT: 3000,

  LOCAL_STORAGE_PATH: "./test_uploads",
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

  const token = await test_signer.decorator.accessJwt.sign({
    userId: user.id,
    tenantId: user.tenantId,
    sessionId: EXAMPLE_UUID,
    role: user.role,
  });

  return {
    Cookie: `accessToken=${token}`,
  };
};

let pass: string;
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
      country: "Test Country",
      email: "test@example.com",
      phone: "05555555555",
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
