import { describe, it, expect } from "bun:test";
import { EnvManager } from "./EnvManager";

const validRaw = (): Record<string, string | undefined> => ({
  NODE_ENV: "development",
  DATABASE_HOST: "localhost",
  DATABASE_PORT: "5432",
  DATABASE_NAME: "bedest",
  DATABASE_USER: "bedest",
  DATABASE_PASSWORD: "bedest",
  SECRET_KEY: "a-very-long-access-secret-key-for-tests-0001",
  REFRESH_KEY: "a-very-long-refresh-secret-key-for-tests-0002",
  PORT: "3000",
});

describe("EnvManager", () => {
  it("[SEC-02] a valid raw env record is accepted and injected values are used", () => {
    const env = new EnvManager().init(validRaw());
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
  });

  it("[SEC-02] missing NODE_ENV throws a clear error instead of defaulting to development", () => {
    const raw = validRaw();
    delete raw.NODE_ENV;
    expect(() => new EnvManager().init(raw)).toThrow(/NODE_ENV/);
  });

  it("[SEC-02] production without CORS_ORIGINS throws", () => {
    const raw = { ...validRaw(), NODE_ENV: "production" };
    expect(() => new EnvManager().init(raw)).toThrow(/CORS_ORIGINS/);
  });

  it("[SEC-02] production with a wildcard in CORS_ORIGINS throws", () => {
    const raw = {
      ...validRaw(),
      NODE_ENV: "production",
      CORS_ORIGINS: "https://app.example.com,*",
    };
    expect(() => new EnvManager().init(raw)).toThrow(/CORS_ORIGINS/);
  });

  it("[SEC-02] production with an explicit CORS_ORIGINS list is accepted", () => {
    const raw = {
      ...validRaw(),
      NODE_ENV: "production",
      CORS_ORIGINS: "https://app.example.com, https://admin.example.com",
    };
    const env = new EnvManager().init(raw);
    expect(env.NODE_ENV).toBe("production");
  });
});
