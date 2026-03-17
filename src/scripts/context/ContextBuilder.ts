import { IApp, IUserApp } from "../../common/interfaces/IContextApp";
import { EUserRole } from "../../features/user/enums/EUserRole";
import { EXAMPLE_UUID } from "../../common/constants";
import EnvManager from "@/infrastructure/env/EnvManager";
import DbManager from "@/infrastructure/database/DbManager";

class ContextBuilder {
  build() {
    EnvManager.init();
    const env = EnvManager.get();
    void DbManager.init(env);
    const db = DbManager.get();

    const MockContext: IApp = {
      db,
      nowDatetime: new Date(),
    };

    const MockUserContext: IUserApp = {
      ...MockContext,
      tenantId: EXAMPLE_UUID,
      session: {
        userId: EXAMPLE_UUID,
        sessionId: EXAMPLE_UUID,
        role: EUserRole.SYSTEM,
      },
    };

    return { MockContext, MockUserContext };
  }
}

export default new ContextBuilder();
