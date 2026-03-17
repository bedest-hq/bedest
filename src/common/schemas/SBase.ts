import { uuid, timestamp, boolean } from "drizzle-orm/pg-core";

export const baseColumns = {
  id: uuid().defaultRandom().primaryKey(),
  isDeleted: boolean().default(false).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
};
