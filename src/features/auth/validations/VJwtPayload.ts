import { EUserRole } from "@f/user/enums/EUserRole";
import { Static, t } from "elysia";

export const VJwtPayload = t.Object({
  tenantId: t.String(),
  userId: t.String(),
  sessionId: t.String(),
  role: t.Enum(EUserRole),
});

export type TJwtPayload = Static<typeof VJwtPayload>;
