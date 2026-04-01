import { EUserRole } from "@/features/user/enums/EUserRole";
import { IUserApp } from "@/common/interfaces/IContextApp";
import { status } from "elysia";

export const MacroRoleGuard = (roles: EUserRole[]) => ({
  beforeHandle({ userRuntime }: { userRuntime?: IUserApp }) {
    if (!userRuntime) {
      throw status("Unauthorized");
    }

    if (!roles.includes(userRuntime.session.role)) {
      throw status("Forbidden");
    }
  },
});
