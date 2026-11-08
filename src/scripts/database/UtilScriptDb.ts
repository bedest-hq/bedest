import { t } from "elysia";
import { TEnv } from "@/common/types/TEnv";
import EnvManager from "@/infrastructure/env/EnvManager";
import DbManager from "@/infrastructure/database/DbManager";

/**
 * Schema-owner credentials for migrations and maintenance scripts
 * [SEC-04]. Script-only: never read by the server. When unset (local
 * development) the runtime login is used.
 */
export const VMigrationEnv = t.Object({
  DATABASE_MIGRATION_USER: t.Optional(t.String({ minLength: 1 })),
  DATABASE_MIGRATION_PASSWORD: t.Optional(t.String()),
});

export class UtilScriptDb {
  static ownerCredentials(
    env: TEnv,
    scriptEnv = EnvManager.parseScript(VMigrationEnv),
  ) {
    return {
      user: scriptEnv.DATABASE_MIGRATION_USER ?? env.DATABASE_USER,
      password: scriptEnv.DATABASE_MIGRATION_PASSWORD ?? env.DATABASE_PASSWORD,
    };
  }

  /** A connection as the schema owner; the caller must `end()` it. */
  static openOwner(env: TEnv) {
    return DbManager.connect(env, UtilScriptDb.ownerCredentials(env));
  }
}
