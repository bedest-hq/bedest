import { EUserRole } from "../../user/enums/EUserRole";

export interface ISession {
  userId: string;
  sessionId: string;
  tenantId?: string;
  role: EUserRole;
}
