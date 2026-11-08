import { describe, it, expect } from "bun:test";
import { sql } from "drizzle-orm";
import { test_owner_db } from "@/common/tests/TestManager.test";
import DbManager from "@/infrastructure/database/DbManager";
import { provisionRoles } from "./ProvisionRoles";

const roleInfo = async (name: string) => {
  const res = await test_owner_db.execute(sql`
    SELECT r.rolcanlogin, r.rolsuper, r.rolbypassrls,
      EXISTS (
        SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
        WHERE m.member = r.oid AND g.rolname = 'bedest_app'
      ) AS "inApp"
    FROM pg_roles r WHERE r.rolname = ${name}
  `);
  return res.rows[0];
};

describe("ProvisionRoles", () => {
  it("[SEC-04] creates a non-privileged LOGIN role in bedest_app, idempotently, without printing the password", async () => {
    const lines: string[] = [];
    const opts = {
      loginRole: "bedest_test_login",
      loginPassword: "a-long-login-password-1",
      print: (l: string) => lines.push(l),
    };

    await provisionRoles(test_owner_db, opts);
    await provisionRoles(test_owner_db, { ...opts, loginPassword: "rotated-password-2" });

    expect(await roleInfo("bedest_test_login")).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      inApp: true,
    });
    expect(lines.join("\n")).not.toContain("a-long-login-password-1");
    expect(lines.join("\n")).not.toContain("rotated-password-2");
  });

  it("[SEC-04] rejects role names that are not plain identifiers", async () => {
    const res = await provisionRoles(test_owner_db, {
      loginRole: 'x"; DROP TABLE users; --',
      loginPassword: "whatever-password",
      print: () => {},
    }).then(
      () => "ok",
      (err: unknown) => String(err),
    );
    expect(res).toContain("Invalid role name");
  });
});

describe("DbManager.verifyRuntimeRole", () => {
  it("[SEC-04] refuses to start in production as a superuser / BYPASSRLS role", async () => {
    const res = await DbManager.verifyRuntimeRole(
      test_owner_db,
      "production",
    ).then(
      () => "started",
      (err: unknown) => String(err),
    );
    expect(res).toContain("row-level security is NOT enforced");
  });

  it("[SEC-04] only warns outside production", async () => {
    expect(
      await DbManager.verifyRuntimeRole(test_owner_db, "development"),
    ).toContain("superuser");
  });

  it("[SEC-04] accepts the bedest_app role in production", async () => {
    expect(
      await DbManager.verifyRuntimeRole(DbManager.get(), "production"),
    ).toBeNull();
  });
});
