import { pgEnum } from "drizzle-orm/pg-core";

export enum EUserRole {
  ADMIN = "ADMIN",
  USER = "USER",
  GUEST = "GUEST",
}

export const EUserRolePg = pgEnum("roles", [
  EUserRole.ADMIN,
  EUserRole.USER,
  EUserRole.GUEST,
]);
