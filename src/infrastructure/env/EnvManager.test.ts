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

describe("EnvManager (SEC-16)", () => {
  const messageOf = (raw: Record<string, string | undefined>) => {
    try {
      new EnvManager().init(raw);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  it("[SEC-16] string values of numeric and boolean variables are coerced", () => {
    const env = new EnvManager().init({
      ...validRaw(),
      DATABASE_PORT: "6543",
      RATE_LIMIT_LOGIN_PER_MIN: "7",
      DATABASE_SSL_MODE: "verify-full",
    });
    expect(env.DATABASE_PORT).toBe(6543);
    expect(env.RATE_LIMIT_LOGIN_PER_MIN).toBe(7);
    expect(env.DATABASE_SSL_MODE).toBe("verify-full");
  });

  it("[SEC-16] two simultaneous errors are both reported in one message", () => {
    const raw = validRaw();
    delete raw.DATABASE_HOST;
    raw.PORT = "not-a-number";
    const message = messageOf(raw);
    expect(message).toContain("DATABASE_HOST");
    expect(message).toContain("PORT");
  });

  it("[SEC-16] identical SECRET_KEY and REFRESH_KEY are rejected", () => {
    const same = "x".repeat(40);
    expect(
      messageOf({ ...validRaw(), SECRET_KEY: same, REFRESH_KEY: same }),
    ).toContain("must differ");
  });

  it("[SEC-16] a secret shorter than 32 characters is rejected", () => {
    expect(messageOf({ ...validRaw(), SECRET_KEY: "short-secret" })).toContain(
      "SECRET_KEY",
    );
  });

  it("[SEC-16] .env.example placeholder values are rejected in production", async () => {
    const example = await Bun.file(".env.example").text();
    const placeholder = (name: string) =>
      example
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${name}=`))
        ?.slice(name.length + 1) ?? "";
    const message = messageOf({
      ...validRaw(),
      NODE_ENV: "production",
      CORS_ORIGINS: "https://app.example.com",
      SECRET_KEY: placeholder("SECRET_KEY"),
      REFRESH_KEY: placeholder("REFRESH_KEY"),
    });
    expect(message).toContain("placeholder");
    expect(message).toContain("SECRET_KEY");
    expect(message).toContain("REFRESH_KEY");
  });
});
