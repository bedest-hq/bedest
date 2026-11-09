import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { IApp, TDbOrTx, UtilTenantScope } from "bedest-core";
import { SUserToken } from "../schemas/SUserToken";
import { EUserTokenType } from "../enums/EUserTokenType";

/** SHA-256 hex of a raw token: the only form ever stored [FEAT-06]. */
export const tokenHashOf = (raw: string) =>
  new Bun.CryptoHasher("sha256").update(raw).digest("hex");

/** 32 random bytes, base64url (43 characters). */
const newRawToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/**
 * One-time account tokens [FEAT-06]. `issue` and `consume` run inside the
 * caller's transaction (a system or tenant scope), so the token and the
 * account change commit or roll back together.
 */
class ServiceUserToken {
  /**
   * Issues a token of `type` for a user and returns the raw value (it goes
   * into the e-mail only). Earlier tokens of the same type for that user
   * are deleted first: only the newest link works.
   */
  async issue(
    tx: TDbOrTx,
    data: {
      userId: string;
      tenantId: string;
      type: EUserTokenType;
      ttlMs: number;
      now: Date;
    },
  ): Promise<string> {
    await tx
      .delete(SUserToken)
      .where(
        and(eq(SUserToken.userId, data.userId), eq(SUserToken.type, data.type)),
      );
    const raw = newRawToken();
    await tx.insert(SUserToken).values({
      userId: data.userId,
      tenantId: data.tenantId,
      type: data.type,
      tokenHash: tokenHashOf(raw),
      expiresAt: new Date(data.now.getTime() + data.ttlMs),
      createdAt: data.now,
    });
    return raw;
  }

  /**
   * Marks an unused, unexpired token of `type` as used and returns its
   * owner, in one UPDATE ... RETURNING (two concurrent uses cannot both
   * succeed); null for an unknown, used, expired or other-type token.
   */
  async consume(
    tx: TDbOrTx,
    raw: string,
    type: EUserTokenType,
    now: Date,
  ): Promise<{ userId: string; tenantId: string } | null> {
    const [row] = await tx
      .update(SUserToken)
      .set({ usedAt: now })
      .where(
        and(
          eq(SUserToken.tokenHash, tokenHashOf(raw)),
          eq(SUserToken.type, type),
          isNull(SUserToken.usedAt),
          gt(SUserToken.expiresAt, now),
        ),
      )
      .returning({
        userId: SUserToken.userId,
        tenantId: SUserToken.tenantId,
      });
    return row ?? null;
  }

  /** Part of job tokens.cleanup [FEAT-08]: used or expired tokens go. */
  async cleanup(c: IApp) {
    const deleted = await UtilTenantScope.systemScope(c.db, (tx) =>
      tx
        .delete(SUserToken)
        .where(
          or(
            isNotNull(SUserToken.usedAt),
            lt(SUserToken.expiresAt, c.nowDatetime),
          ),
        )
        .returning({ id: SUserToken.id }),
    );
    return { count: deleted.length };
  }
}

export default new ServiceUserToken();
