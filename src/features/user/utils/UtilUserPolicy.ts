import { EUserRole } from "../enums/EUserRole";

export interface IPolicyActor {
  role: string;
  userId: string;
  tenantId: string;
}

export interface IPolicyTarget {
  role: string;
  id: string;
  tenantId: string;
}

const RANK: Record<string, number> = {
  [EUserRole.USER]: 1,
  [EUserRole.ADMIN]: 2,
  [EUserRole.SYSTEM]: 3,
};

const rank = (role: string): number => RANK[role] ?? 0;

/**
 * The single source of truth for who may manage which user account.
 *
 * - SYSTEM manages everyone.
 * - ADMIN manages only USER accounts of its own tenant.
 * - USER manages nobody.
 * - Acting on yourself is not "managing": it is only possible through the
 *   self-service paths (rename, own password with `currentPassword`) and
 *   never includes a role change.
 */
export class UtilUserPolicy {
  static canManage(actor: IPolicyActor, target: IPolicyTarget): boolean {
    if (actor.role === EUserRole.SYSTEM) {
      return true;
    }
    if (actor.role === EUserRole.ADMIN) {
      return (
        target.role === EUserRole.USER && target.tenantId === actor.tenantId
      );
    }
    return false;
  }

  /**
   * Whether `actorRole` may create an account with, or assign, `role`.
   * Never a role above the actor's own; ADMIN only ever creates USERs.
   */
  static canGrantRole(actorRole: string, role: string): boolean {
    if (rank(role) === 0 || rank(role) > rank(actorRole)) {
      return false;
    }
    if (actorRole === EUserRole.SYSTEM) {
      return true;
    }
    if (actorRole === EUserRole.ADMIN) {
      return role === EUserRole.USER;
    }
    return false;
  }

  static isSelf(actor: IPolicyActor, target: Pick<IPolicyTarget, "id">) {
    return actor.userId === target.id;
  }
}
