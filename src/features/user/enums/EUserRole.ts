import { pgEnum } from "drizzle-orm/pg-core";

export enum EUserRole {
  SYSTEM = "SYSTEM",
  ADMIN = "ADMIN",
  USER = "USER",
  GUEST = "GUEST",
}

export const EUserRolePg = pgEnum("roles", [
  EUserRole.SYSTEM,
  EUserRole.ADMIN,
  EUserRole.USER,
  EUserRole.GUEST,
]);
