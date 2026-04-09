import EnvManager from "@/infrastructure/env/EnvManager";
import { rm } from "node:fs/promises";

class StorageReset {
  async reset() {
    EnvManager.init();
    const env = EnvManager.get();

    if (env.LOCAL_STORAGE_PATH) {
      await rm(env.LOCAL_STORAGE_PATH, { recursive: true, force: true });
    }
  }
}

void new StorageReset().reset();
