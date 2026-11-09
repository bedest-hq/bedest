import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import {
  createForeignTenant,
  createTestUser,
  test_db,
  test_runtime_db,
  testHeaders,
} from "@/common/tests/TestManager.test";
import { ErrorHandler } from "@/infrastructure/error/ErrorHandler";
import MailManager from "@/infrastructure/mail/MailManager";
import { ProviderMailConsole } from "@/infrastructure/mail/providers/ProviderMailConsole";
import { ProviderMailSmtp } from "@/infrastructure/mail/providers/ProviderMailSmtp";
import { EUserRole } from "@f/user/enums/EUserRole";
import { EUserStatus } from "@f/user/enums/EUserStatus";
import { SUser } from "@f/user/schemas/SUser";
import { RouterUser } from "@f/user/routers/RouterUser";
import ServiceInvite, { INVITE_TTL_MS } from "@f/user/services/ServiceInvite";
import { RouterTenant } from "@f/tenant/routers/RouterTenant";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";
import { SSystemLog } from "@f/system/schemas/SSystemLog";
import { SUserToken } from "../schemas/SUserToken";
import { EUserTokenType } from "../enums/EUserTokenType";
import ServicePasswordReset, {
  PASSWORD_RESET_TTL_MS,
} from "../services/ServicePasswordReset";
import ServiceLoginLockout, {
  emailHashOf,
  LOCKOUT_MAX_FAILURES,
} from "../services/ServiceLoginLockout";
import { tokenHashOf } from "../services/ServiceUserToken";
import { RouterAuth } from "./RouterAuth";

const app = new Elysia()
  .use(ErrorHandler)
  .use(RouterAuth)
  .use(RouterUser)
  .use(RouterTenant);

const call = (method: string, path: string, body?: unknown, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const NEW_PASSWORD = "a-brand-new-password";

let outbox: ProviderMailConsole;
let restoreMail: () => void;

beforeEach(() => {
  outbox = new ProviderMailConsole();
  restoreMail = MailManager.useProviderForTesting(outbox);
});

afterEach(() => {
  restoreMail();
});

/** The one-time token of the newest e-mail to `to`. */
const tokenSentTo = (to: string) => {
  const msg = outbox.sent.filter((m) => m.to === to).at(-1);
  const match = /#token=([A-Za-z0-9_-]{43})$/m.exec(msg?.text ?? "");
  if (!match?.[1]) {
    throw new Error(`no token e-mailed to ${to}`);
  }
  return match[1];
};

const login = (email: string, password: string) =>
  call("POST", "/auth/login", { email, password });

const accessCookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith("accessToken="))
    ?.split(";")[0] ?? "";

const auditRows = async (action: string, entityId: string) =>
  await test_db
    .select({ payload: SSystemLog.payload })
    .from(SSystemLog)
    .where(
      and(eq(SSystemLog.action, action), eq(SSystemLog.entityId, entityId)),
    );

const userById = async (id: string) => {
  const [row] = await test_db
    .select({ status: SUser.status, name: SUser.name, role: SUser.role })
    .from(SUser)
    .where(eq(SUser.id, id));
  return row;
};

describe("FEAT-06: password reset", () => {
  it("[FEAT-06] forgot → 202 and one e-mail whose link carries the token in the fragment; only its SHA-256 is stored", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const res = await call("POST", "/auth/password/forgot", {
      email: user.email.toUpperCase(),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true });

    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]?.text).toContain(
      "http://localhost:5173/reset-password#token=",
    );
    const token = tokenSentTo(user.email);
    const rows = await test_db
      .select({ tokenHash: SUserToken.tokenHash, type: SUserToken.type })
      .from(SUserToken)
      .where(eq(SUserToken.userId, user.id));
    expect(rows).toEqual([
      { tokenHash: tokenHashOf(token), type: EUserTokenType.PASSWORD_RESET },
    ]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("[FEAT-06] unknown and INVITED addresses get the same 202, no e-mail, and the same password-hash work", async () => {
    const invited = await createTestUser(EUserRole.USER);
    await test_db
      .update(SUser)
      .set({ status: EUserStatus.INVITED })
      .where(eq(SUser.id, invited.user.id));
    const known = await createTestUser(EUserRole.USER);

    const verify = spyOn(Bun.password, "verify");
    try {
      for (const email of [
        "nobody@example.com",
        invited.user.email,
        known.user.email,
      ]) {
        verify.mockClear();
        const res = await call("POST", "/auth/password/forgot", { email });
        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ success: true });
        expect(verify).toHaveBeenCalledTimes(1);
      }
    } finally {
      verify.mockRestore();
    }
    expect(outbox.sent.map((m) => m.to)).toEqual([known.user.email]);
  });

  it("[FEAT-06] reset stores the new password, revokes every session, is single-use and audited", async () => {
    const { user, headers } = await createTestUser(EUserRole.USER);
    const other = await testHeaders(user);
    await call("POST", "/auth/password/forgot", { email: user.email });
    const token = tokenSentTo(user.email);

    const res = await call("POST", "/auth/password/reset", {
      token,
      password: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);

    for (const cookie of [headers.Cookie, other.Cookie]) {
      expect((await call("GET", "/user/self", undefined, cookie)).status).toBe(
        401,
      );
    }
    expect((await login(user.email, "test_password")).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);

    const again = await call("POST", "/auth/password/reset", {
      token,
      password: "yet-another-password",
    });
    expect(again.status).toBe(400);

    const audit = await auditRows("PASSWORD_RESET", user.id);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it("[FEAT-06] a newer link replaces the older one, and links expire after 30 minutes", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    await call("POST", "/auth/password/forgot", { email: user.email });
    const first = tokenSentTo(user.email);
    await call("POST", "/auth/password/forgot", { email: user.email });
    const second = tokenSentTo(user.email);
    expect(second).not.toBe(first);

    const reset = (token: string) =>
      call("POST", "/auth/password/reset", { token, password: NEW_PASSWORD });
    expect((await reset(first)).status).toBe(400);

    const late = await ServicePasswordReset.reset(
      {
        db: test_runtime_db,
        nowDatetime: new Date(Date.now() + PASSWORD_RESET_TTL_MS + 1000),
      },
      second,
      NEW_PASSWORD,
    ).then(
      () => "ok",
      (e: unknown) =>
        typeof e === "object" && e !== null && "code" in e ? e.code : e,
    );
    expect(late).toBe(400);
    expect((await reset(second)).status).toBe(200);
  });

  it("[FEAT-06] reset enforces the password policy and the token format", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    await call("POST", "/auth/password/forgot", { email: user.email });
    const token = tokenSentTo(user.email);

    expect(
      (
        await call("POST", "/auth/password/reset", {
          token,
          password: "a".repeat(11),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/auth/password/reset", {
          token: "not-a-token",
          password: NEW_PASSWORD,
        })
      ).status,
    ).toBe(400);
    // The rejected attempts did not use the token up.
    expect(
      (
        await call("POST", "/auth/password/reset", {
          token,
          password: NEW_PASSWORD,
        })
      ).status,
    ).toBe(200);
  });

  it("[FEAT-06] a reset ends an account lockout", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const c = { db: test_runtime_db, nowDatetime: new Date() };
    const hash = emailHashOf(user.email);
    for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
      await ServiceLoginLockout.recordFailure(c, hash);
    }
    expect(await ServiceLoginLockout.isLocked(c, hash)).toBe(true);

    await call("POST", "/auth/password/forgot", { email: user.email });
    await call("POST", "/auth/password/reset", {
      token: tokenSentTo(user.email),
      password: NEW_PASSWORD,
    });
    expect(await ServiceLoginLockout.isLocked(c, hash)).toBe(false);
  });

  it("[FEAT-06] forgot is rate limited: 3 per hour per e-mail, 5 per minute per IP", async () => {
    const { user } = await createTestUser(EUserRole.USER);
    const forgot = (email: string) =>
      call("POST", "/auth/password/forgot", { email });
    for (let i = 0; i < 3; i++) {
      expect((await forgot(user.email)).status).toBe(202);
    }
    expect((await forgot(user.email)).status).toBe(429);

    // The refused 4th request counted for this IP too: one more address
    // reaches the 5 per minute.
    expect((await forgot("someone-1@example.com")).status).toBe(202);
    expect((await forgot("someone-2@example.com")).status).toBe(429);
  });
});

describe("FEAT-06: invitations", () => {
  const email = () => `invitee_${crypto.randomUUID().slice(0, 8)}@example.com`;

  it("[FEAT-06] an ADMIN invites a USER: INVITED account, e-mailed link, no login, listed as INVITED", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const address = email();
    const res = await call(
      "POST",
      "/user/invite",
      { email: address, role: EUserRole.USER },
      admin.headers.Cookie,
    );
    expect(res.status).toBe(200);
    const { id }: { id: string } = await res.json();

    expect(await userById(id)).toMatchObject({
      status: EUserStatus.INVITED,
      role: EUserRole.USER,
    });
    expect(outbox.sent[0]?.text).toContain(
      "http://localhost:5173/accept-invite#token=",
    );
    tokenSentTo(address);
    expect((await login(address, "test_password")).status).toBe(401);

    const list: { data: Array<{ id: string; status: string }> } = await (
      await call(
        "GET",
        "/user/?page=1&limit=100",
        undefined,
        admin.headers.Cookie,
      )
    ).json();
    expect(list.data.find((u) => u.id === id)?.status).toBe(
      EUserStatus.INVITED,
    );
  });

  it("[FEAT-06] accepting activates the account, signs in, is single-use and audited", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const address = email();
    const { id }: { id: string } = await (
      await call(
        "POST",
        "/user/invite",
        { email: address, role: EUserRole.USER, name: "Placeholder" },
        admin.headers.Cookie,
      )
    ).json();
    const token = tokenSentTo(address);

    const res = await call("POST", "/auth/invite/accept", {
      token,
      name: "Jane Invitee",
      password: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, id });
    const self = await call(
      "GET",
      "/user/self",
      undefined,
      accessCookieOf(res),
    );
    expect(self.status).toBe(200);
    expect(await self.json()).toMatchObject({ name: "Jane Invitee" });

    expect(await userById(id)).toMatchObject({ status: EUserStatus.ACTIVE });
    expect((await login(address, NEW_PASSWORD)).status).toBe(200);
    expect(
      (
        await call("POST", "/auth/invite/accept", {
          token,
          name: "Again",
          password: NEW_PASSWORD,
        })
      ).status,
    ).toBe(400);
    expect(await auditRows("INVITE_ACCEPTED", id)).toHaveLength(1);
  });

  it("[FEAT-06] invitations follow the role policy (SEC-12)", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const user = await createTestUser(EUserRole.USER);
    expect(
      (
        await call(
          "POST",
          "/user/invite",
          { email: email(), role: EUserRole.ADMIN },
          admin.headers.Cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          "/user/invite",
          { email: email(), role: EUserRole.USER },
          user.headers.Cookie,
        )
      ).status,
    ).toBe(403);
    // Unauthenticated → 401.
    expect(
      (
        await call("POST", "/user/invite", {
          email: email(),
          role: EUserRole.USER,
        })
      ).status,
    ).toBe(401);
  });

  it("[FEAT-06] an active e-mail in any tenant → 409; re-inviting an INVITED user sends a new link and only it works", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const foreign = await createForeignTenant(EUserRole.USER);
    const invite = (address: string) =>
      call(
        "POST",
        "/user/invite",
        { email: address, role: EUserRole.USER },
        admin.headers.Cookie,
      );
    expect((await invite(admin.user.email)).status).toBe(409);
    expect((await invite(foreign.user.email.toUpperCase())).status).toBe(409);

    const address = email();
    expect((await invite(address)).status).toBe(200);
    const first = tokenSentTo(address);
    expect((await invite(address)).status).toBe(200);
    const second = tokenSentTo(address);

    const accept = (token: string) =>
      call("POST", "/auth/invite/accept", {
        token,
        name: "Re Invited",
        password: NEW_PASSWORD,
      });
    expect((await accept(first)).status).toBe(400);
    expect((await accept(second)).status).toBe(200);
  });

  it("[FEAT-06] a failed invitation e-mail → 502 and nothing is created", async () => {
    restoreMail();
    restoreMail = MailManager.useProviderForTesting(
      new ProviderMailSmtp("no-reply@example.com", {
        sendMail: () => Promise.reject(new Error("connect ECONNREFUSED")),
      }),
    );
    const admin = await createTestUser(EUserRole.ADMIN);
    const address = email();
    const res = await call(
      "POST",
      "/user/invite",
      { email: address, role: EUserRole.USER },
      admin.headers.Cookie,
    );
    expect(res.status).toBe(502);
    expect(
      await test_db.select().from(SUser).where(eq(SUser.email, address)),
    ).toEqual([]);
  });

  it("[FEAT-06] an invitation expires after 7 days", async () => {
    const admin = await createTestUser(EUserRole.ADMIN);
    const address = email();
    await call(
      "POST",
      "/user/invite",
      { email: address, role: EUserRole.USER },
      admin.headers.Cookie,
    );
    const late = await ServiceInvite.accept(
      {
        db: test_runtime_db,
        nowDatetime: new Date(Date.now() + INVITE_TTL_MS + 1000),
      },
      { token: tokenSentTo(address), name: "Late", password: NEW_PASSWORD },
      {},
    ).then(
      () => "ok",
      (e: unknown) =>
        typeof e === "object" && e !== null && "code" in e ? e.code : e,
    );
    expect(late).toBe(400);
  });

  it("[SEC-23][FEAT-06] POST /tenant invites the ADMIN (no password returned); the admin accepts and signs in to the new tenant", async () => {
    const address = email();
    const res = await call(
      "POST",
      "/tenant",
      {
        name: "Invited Tenant",
        domain: `inv-${crypto.randomUUID().slice(0, 8)}.example.com`,
        country: "Germany",
        phones: ["+49123456789"],
        email: address,
        plan: ETenantPlan.BASIC,
        planStart: new Date(),
        planEnd: new Date(),
      },
      (await testHeaders()).Cookie,
    );
    expect(res.status).toBe(200);
    const { id: tenantId }: { id: string } = await res.json();

    const accepted = await call("POST", "/auth/invite/accept", {
      token: tokenSentTo(address),
      name: "Tenant Admin",
      password: NEW_PASSWORD,
    });
    expect(accepted.status).toBe(200);
    const self = await call(
      "GET",
      "/tenant/self",
      undefined,
      accessCookieOf(accepted),
    );
    expect(self.status).toBe(200);
    expect(await self.json()).toMatchObject({ id: tenantId });
  });
});
