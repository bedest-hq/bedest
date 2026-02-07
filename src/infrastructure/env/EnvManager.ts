import { SEnv } from "@/common/schemas/SEnv";
import { TEnv } from "@/common/types/TEnv";

class EnvManager {
  private env: TEnv | undefined;

  init(): TEnv {
    if (this.env) {
      return this.env;
    }

    const raw = { ...Bun.env };
    const parsed = SEnv.parse(raw);

    this.env = parsed;
    return this.env;
  }

  get(): TEnv {
    if (!this.env) {
      throw new Error("Env is not initialized. Call EnvManager.init() first.");
    }
    return this.env;
  }
}

export default new EnvManager();
