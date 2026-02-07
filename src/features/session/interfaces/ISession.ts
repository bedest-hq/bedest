import { EUserRole } from "../../user/enums/EUserRole";

export interface ISession {
  userId: string;
  tenantId?: string;
  role: EUserRole;
}
