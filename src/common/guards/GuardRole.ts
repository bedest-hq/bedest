import { EUserRole } from "@/features/user/enums/EUserRole";
import { IUserApp } from "@/common/interfaces/IContextApp";
import { status } from "elysia";

export const MacroRoleGuard = (roles: EUserRole[]) => ({
  beforeHandle({ userRuntime }: { userRuntime?: IUserApp }) {
    if (!userRuntime) {
      throw status(401, "Authentication required.");
    }

    if (!roles.includes(userRuntime.session.role)) {
      throw status(403, "You do not have permission to access this resource.");
    }
  },
});
