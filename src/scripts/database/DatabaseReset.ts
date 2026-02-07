import DbManager from "@/infrastructure/db/DbManager";
import EnvManager from "@/infrastructure/env/EnvManager";

class DatabaseReset {
  async reset() {
    EnvManager.init();
    const env = EnvManager.get();
    await DbManager.recreate(env);
  }
}

void new DatabaseReset().reset();
