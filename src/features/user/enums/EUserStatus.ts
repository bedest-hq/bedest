import { pgEnum } from "drizzle-orm/pg-core";

/** Account state [FEAT-06]: an INVITED user cannot log in yet. */
export enum EUserStatus {
  ACTIVE = "ACTIVE",
  INVITED = "INVITED",
}

export const EUserStatusPg = pgEnum("user_status", [
  EUserStatus.ACTIVE,
  EUserStatus.INVITED,
]);
