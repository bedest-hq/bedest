import { VUserRole } from "@f/user/validations/VUserRole";
import { Static, t } from "elysia";

export const VJwtPayload = t.Object({
  tenantId: t.String(),
  userId: t.String(),
  sessionId: t.String(),
  role: VUserRole,
});

export type TJwtPayload = Static<typeof VJwtPayload>;

/** JWT "aud" claim of every token this API issues [SEC-24]. */
export const JWT_AUDIENCE = "bedest-api";

/**
 * The "typ" claim tells access and refresh tokens apart even when both are
 * signed with a valid key: each plugin only accepts its own type [SEC-24].
 */
export const VAccessJwtPayload = t.Object({
  ...VJwtPayload.properties,
  typ: t.Literal("access"),
});

export const VRefreshJwtPayload = t.Object({
  ...VJwtPayload.properties,
  typ: t.Literal("refresh"),
});
