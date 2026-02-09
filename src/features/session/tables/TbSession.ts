import { uuid, pgTable, timestamp, index } from "drizzle-orm/pg-core";

export const TbSession = pgTable(
  "sessions",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },

  (t) => [index().on(t.userId)],
);
