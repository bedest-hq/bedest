import { describe, it, expect } from "bun:test";
import { UtilDbSsl } from "./UtilDbSsl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("UtilDbSsl", () => {
  it("[SEC-15] defaults to verify-full in production and disable elsewhere", () => {
    expect(UtilDbSsl.mode({ NODE_ENV: "production" })).toBe("verify-full");
    expect(UtilDbSsl.mode({ NODE_ENV: "development" })).toBe("disable");
    expect(UtilDbSsl.mode({ NODE_ENV: "test" })).toBe("disable");
  });

  it("[SEC-15] disable → no TLS", () => {
    expect(
      UtilDbSsl.options({
        NODE_ENV: "production",
        DATABASE_SSL_MODE: "disable",
      }),
    ).toBe(false);
  });

  it("[SEC-15] require → TLS without certificate verification (explicit opt-in)", () => {
    const opts = UtilDbSsl.options({
      NODE_ENV: "development",
      DATABASE_SSL_MODE: "require",
    });
    expect(opts === false ? "no-tls" : opts.rejectUnauthorized).toBe(false);
  });

  it("[SEC-15] verify-full → certificates are verified (production default)", () => {
    expect(UtilDbSsl.options({ NODE_ENV: "production" })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("[SEC-15] DATABASE_SSL_CA accepts PEM content or a file path", () => {
    expect(
      UtilDbSsl.options({
        NODE_ENV: "production",
        DATABASE_SSL_MODE: "verify-full",
        DATABASE_SSL_CA: PEM,
      }),
    ).toEqual({ rejectUnauthorized: true, ca: PEM });

    const read: string[] = [];
    expect(
      UtilDbSsl.options(
        {
          NODE_ENV: "production",
          DATABASE_SSL_MODE: "verify-full",
          DATABASE_SSL_CA: "/etc/ssl/rds-ca.pem",
        },
        (path) => {
          read.push(path);
          return PEM;
        },
      ),
    ).toEqual({ rejectUnauthorized: true, ca: PEM });
    expect(read).toEqual(["/etc/ssl/rds-ca.pem"]);
  });
});
