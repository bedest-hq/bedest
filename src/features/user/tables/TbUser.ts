import {
  uuid,
  pgTable,
  varchar,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { EUserRolePg } from "../enums/EUserRole";
import { sql } from "drizzle-orm";

export const TbUser = pgTable(
  "users",
  {
    id: uuid().defaultRandom().primaryKey(),
    isDeleted: boolean().default(false).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
    name: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    role: EUserRolePg().notNull(),
    password: varchar({ length: 255 }).notNull(),
  },
  (t) => [
    index().on(t.isDeleted),
    uniqueIndex()
      .on(t.email)
      .where(sql`"isDeleted" = false`),
  ],
);
