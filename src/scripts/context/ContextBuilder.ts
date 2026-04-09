import { IApp, IUserApp } from "../../common/interfaces/IContextApp";
import { EUserRole } from "../../features/user/enums/EUserRole";
import { SYSTEM_UUID } from "../../common/constants";
import EnvManager from "@/infrastructure/env/EnvManager";
import DbManager from "@/infrastructure/database/DbManager";

class ContextBuilder {
  build() {
    EnvManager.init();
    const env = EnvManager.get();
    void DbManager.init(env);
    const db = DbManager.get();

    const context: IApp = {
      db,
      nowDatetime: new Date(),
    };

    const userContext: IUserApp = {
      ...context,
      tenantId: SYSTEM_UUID,
      session: {
        userId: SYSTEM_UUID,
        sessionId: SYSTEM_UUID,
        role: EUserRole.SYSTEM,
      },
    };

    return { context, userContext };
  }
}

export default new ContextBuilder();
