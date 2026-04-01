import { TEnv } from "@/common/types/TEnv";
import { VEnv } from "@/common/validations/VCommon";
import { Value } from "@sinclair/typebox/value";

class EnvManager {
  private env: TEnv | undefined;

  init(): TEnv {
    if (this.env) {
      return this.env;
    }

    const raw = {
      ...Bun.env,
      DATABASE_PORT: Number(Bun.env.DATABASE_PORT),
      PORT: Number(Bun.env.PORT),
    };

    const withDefaults = Value.Default(VEnv, raw);

    if (!Value.Check(VEnv, withDefaults)) {
      const firstError = [...Value.Errors(VEnv, withDefaults)][0];

      throw new Error(
        `Env Configuration Error [${firstError.path}]: ${firstError.message}`,
      );
    }

    this.env = withDefaults;
    return this.env;
  }

  get(): TEnv {
    if (!this.env) {
      return this.init();
    }
    return this.env;
  }
}

export default new EnvManager();
