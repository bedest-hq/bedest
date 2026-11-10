import { and, eq, sql } from "drizzle-orm";
import { IApp, ITenantUserApp, TDbOrTx, UtilTenantScope } from "bedest-core";
import { UtilHttp } from "@/common/utils/UtilHttp";
import MailManager from "@/infrastructure/mail/MailManager";
import { MailTemplates } from "@/infrastructure/mail/MailTemplates";
import { EUserTokenType } from "@f/auth/enums/EUserTokenType";
import ServiceUserToken from "@f/auth/services/ServiceUserToken";
import ServiceSession, {
  type ISessionMeta,
} from "@f/session/services/ServiceSession";
import ServiceSystem from "@f/system/services/ServiceSystem";
import ServiceSystemLog from "@f/system/services/ServiceSystemLog";
import { SUser } from "../schemas/SUser";
import { EUserRole } from "../enums/EUserRole";
import { EUserStatus } from "../enums/EUserStatus";
import { UtilEmail } from "../utils/UtilEmail";
import { UtilUserPolicy } from "../utils/UtilUserPolicy";

/** An invitation link is valid for 7 days [FEAT-06]. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A password nobody knows: INVITED users cannot log in anyway. */
const unusablePasswordHash = () =>
  Bun.password.hash(
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      "base64url",
    ),
  );

class ServiceInvite {
  /**
   * Creates an INVITED user with a 7-day INVITE token and e-mails the link,
   * inside the caller's transaction [FEAT-06]. The e-mail is the last step:
   * when it cannot be sent, the user and the token roll back and the call
   * can simply be repeated. An e-mail of an INVITED user of the same tenant
   * re-invites (new token, earlier links stop working); any other existing
   * active account is a 409.
   */
  async inviteInTx(
    tx: TDbOrTx,
    now: Date,
    data: { tenantId: string; email: string; role: EUserRole; name?: string },
  ): Promise<string> {
    const email = UtilEmail.normalize(data.email);
    const name = data.name ?? email.slice(0, email.indexOf("@"));

    const [existing] = await tx
      .select({ id: SUser.id, tenantId: SUser.tenantId, status: SUser.status })
      .from(SUser)
      .where(
        and(sql`lower(${SUser.email}) = ${email}`, eq(SUser.isDeleted, false)),
      )
      .limit(1);

    let userId: string;
    if (existing) {
      if (
        existing.status !== EUserStatus.INVITED ||
        existing.tenantId !== data.tenantId
      ) {
        throw UtilHttp.fail(409, "A user with this e-mail already exists");
      }
      await tx
        .update(SUser)
        .set({ role: data.role, name, updatedAt: now })
        .where(eq(SUser.id, existing.id));
      userId = existing.id;
    } else {
      const [created] = await tx
        .insert(SUser)
        .values({
          tenantId: data.tenantId,
          email,
          name,
          role: data.role,
          status: EUserStatus.INVITED,
          password: await unusablePasswordHash(),
          createdAt: now,
        })
        .returning({ id: SUser.id });
      if (!created) {
        throw UtilHttp.fail(500);
      }
      userId = created.id;
    }

    const token = await ServiceUserToken.issue(tx, {
      userId,
      tenantId: data.tenantId,
      type: EUserTokenType.INVITE,
      ttlMs: INVITE_TTL_MS,
      now,
    });
    await MailManager.send(
      MailTemplates.invitation(
        email,
        MailManager.link("/accept-invite", token),
        INVITE_TTL_MS / (24 * 60 * 60 * 1000),
      ),
    );
    return userId;
  }

  /**
   * POST /user/invite [FEAT-06]: ADMIN/SYSTEM invite into their own
   * tenant, under the role policy [SEC-12]. Runs in the actor's tenant
   * scope; an e-mail used in another tenant hits the unique index (409).
   */
  async invite(
    c: ITenantUserApp,
    data: { email: string; role: EUserRole; name?: string },
  ) {
    if (!UtilUserPolicy.canGrantRole(c.session.role, data.role)) {
      throw UtilHttp.fail(403);
    }
    const id = await UtilTenantScope.tenantScope(c, (tx) =>
      this.inviteInTx(tx, c.nowDatetime, { ...data, tenantId: c.tenantId }),
    );
    return { id };
  }

  /**
   * POST /auth/invite/accept [FEAT-06]: a single-use INVITE token makes
   * the user ACTIVE with the chosen name and password and opens a session
   * (the router sets the cookies). INVITE_ACCEPTED is audited.
   */
  async accept(
    c: IApp,
    data: { token: string; name: string; password: string },
    meta: ISessionMeta,
  ) {
    if (await ServiceSystem.getMaintenance(c)) {
      throw UtilHttp.fail(503);
    }

    const user = await UtilTenantScope.systemScope(c.db, async (tx) => {
      const owner = await ServiceUserToken.consume(
        tx,
        data.token,
        EUserTokenType.INVITE,
        c.nowDatetime,
      );
      if (!owner) {
        return null;
      }
      const [row] = await tx
        .update(SUser)
        .set({
          name: data.name,
          password: await Bun.password.hash(data.password),
          status: EUserStatus.ACTIVE,
          updatedAt: c.nowDatetime,
        })
        .where(
          and(
            eq(SUser.id, owner.userId),
            eq(SUser.isDeleted, false),
            eq(SUser.status, EUserStatus.INVITED),
          ),
        )
        .returning({
          id: SUser.id,
          tenantId: SUser.tenantId,
          role: SUser.role,
        });
      return row ?? null;
    });

    if (!user) {
      throw UtilHttp.fail(400, "Invalid or expired invitation");
    }

    const session = await ServiceSession.create(c, {
      tenantId: user.tenantId,
      userId: user.id,
      meta,
    });
    await ServiceSystemLog.logEvent(c.db, {
      tenantId: user.tenantId,
      userId: user.id,
      action: "INVITE_ACCEPTED",
      entity: "user",
      entityId: user.id,
      payload: {},
    });

    return {
      tenantId: user.tenantId,
      userId: user.id,
      sessionId: session.id,
      role: user.role,
    };
  }
}

export default new ServiceInvite();
