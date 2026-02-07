import {
  uuid,
  pgTable,
  varchar,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const TbExample = pgTable(
  "examples",
  {
    id: uuid().defaultRandom().primaryKey(),
    isDeleted: boolean().default(false).notNull(),
    createdAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    exampleColumn: varchar({ length: 255 }).notNull(),
    otherExampleColumn: varchar({ length: 255 }).notNull().unique(),
  },
  (t) => [index().on(t.id, t.isDeleted)],
);
