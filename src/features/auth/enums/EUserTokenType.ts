import { pgEnum } from "drizzle-orm/pg-core";

/** Purpose of a one-time account token [FEAT-06]. */
export enum EUserTokenType {
  PASSWORD_RESET = "PASSWORD_RESET",
  INVITE = "INVITE",
  EMAIL_VERIFY = "EMAIL_VERIFY",
}

export const EUserTokenTypePg = pgEnum("user_token_type", [
  EUserTokenType.PASSWORD_RESET,
  EUserTokenType.INVITE,
  EUserTokenType.EMAIL_VERIFY,
]);
