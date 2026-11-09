import { describe, it, expect } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

/**
 * Data migrations are tested on a fresh database migrated step by step
 * (each migration in its own transaction, as the migrator does), so rows
 * can be seeded between two migrations.
 */
const journal = (await Bun.file("drizzle/meta/_journal.json").json()) as {
  entries: Array<{ tag: string }>;
};

const apply = async (db: PGlite, tag: string) => {
  const statements = (await Bun.file(`drizzle/${tag}.sql`).text())
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  await db.transaction(async (tx) => {
    for (const statement of statements) {
      await tx.exec(statement);
    }
  });
};

const migrateThrough = async (db: PGlite, lastTag: string) => {
  for (const { tag } of journal.entries) {
    await apply(db, tag);
    if (tag === lastTag) {
      return;
    }
  }
  throw new Error(`migration ${lastTag} not found`);
};

const tagStartingWith = (prefix: string) => {
  const entry = journal.entries.find((e) => e.tag.startsWith(prefix));
  if (!entry) {
    throw new Error(`no migration ${prefix}`);
  }
  return entry.tag;
};

describe("migrations (BUG-05)", () => {
  it("[BUG-05] 0009/0010 keep the earliest receipt per (notification, user) and then enforce uniqueness", async () => {
    const db = new PGlite();
    try {
      await migrateThrough(db, tagStartingWith("0008_"));
      await db.exec(`
        INSERT INTO tenants (id, name, domain, country, email, plan, "planStart", "planEnd")
        VALUES ('11111111-1111-1111-1111-111111111111', 'T', 't.example', 'X', 't@example.com', 'BASIC', now(), now());
        INSERT INTO notifications (id, "tenantId", "isBroadcast", event)
        VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', true, 'news');
        INSERT INTO notification_reads ("tenantId", "notificationId", "userId", "readAt") VALUES
          ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '2024-01-02'),
          ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '2024-01-01'),
          ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '2024-01-03');
      `);

      await apply(db, tagStartingWith("0009_"));
      await apply(db, tagStartingWith("0010_"));

      const rows = await db.query<{ readAt: Date }>(
        'SELECT "readAt" FROM notification_reads',
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.readAt.toISOString()).toStartWith("2024-01-01");

      const again = await db
        .exec(
          'INSERT INTO notification_reads ("tenantId", "notificationId", "userId", "readAt") VALUES (\'11111111-1111-1111-1111-111111111111\', \'22222222-2222-2222-2222-222222222222\', \'33333333-3333-3333-3333-333333333333\', now())',
        )
        .then(
          () => "inserted",
          (err: unknown) => String(err),
        );
      expect(again).toContain("uq_notification_reads_user_notification");
    } finally {
      await db.close();
    }
  });
});

describe("migrations", () => {
  it("[SEC-21] 0005/0006 keep the oldest of case-duplicates, soft-delete the rest, lower-case all and enforce case-insensitive uniqueness", async () => {
    const db = new PGlite();
    try {
      await migrateThrough(db, tagStartingWith("0004_"));
      await db.exec(`
        INSERT INTO tenants (id, name, domain, country, email, plan, "planStart", "planEnd")
        VALUES ('11111111-1111-1111-1111-111111111111', 'T', 't.example', 'X', 't@example.com', 'BASIC', now(), now());
        INSERT INTO users (id, "tenantId", name, email, role, password, "createdAt", "isDeleted") VALUES
          ('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'old', 'Dup@Example.com', 'USER', 'x', '2020-01-01', false),
          ('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'new', ' dup@example.COM', 'USER', 'x', '2021-01-01', false),
          ('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'gone', 'DUP@example.com', 'USER', 'x', '2019-01-01', true),
          ('00000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'solo', 'Solo@X.com', 'USER', 'x', '2020-01-01', false);
      `);

      await apply(db, tagStartingWith("0005_"));
      await apply(db, tagStartingWith("0006_"));

      const rows = await db.query<{
        id: string;
        email: string;
        isDeleted: boolean;
      }>('SELECT id, email, "isDeleted" FROM users ORDER BY id');
      expect(rows.rows).toEqual([
        {
          id: "00000000-0000-0000-0000-00000000000a",
          email: "dup@example.com",
          isDeleted: false,
        },
        {
          id: "00000000-0000-0000-0000-00000000000b",
          email: "dup@example.com",
          isDeleted: true,
        },
        {
          id: "00000000-0000-0000-0000-00000000000c",
          email: "dup@example.com",
          isDeleted: true,
        },
        {
          id: "00000000-0000-0000-0000-00000000000d",
          email: "solo@x.com",
          isDeleted: false,
        },
      ]);

      const duplicate = await db
        .exec(
          "INSERT INTO users (\"tenantId\", name, email, role, password) VALUES ('11111111-1111-1111-1111-111111111111', 'again', 'DUP@EXAMPLE.COM', 'USER', 'x')",
        )
        .then(
          () => "inserted",
          (err: unknown) => String(err),
        );
      expect(duplicate).toContain("idx_users_email_lower");
    } finally {
      await db.close();
    }
  });
});

describe("migrations (SEC-27)", () => {
  it("[SEC-27] 0014 clears foreign and dangling logo/avatar references, 0015 adds the tenants.logoId foreign key", async () => {
    const db = new PGlite();
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const FILE_B = "f0000000-0000-4000-8000-00000000000b";
    try {
      await migrateThrough(db, tagStartingWith("0013_"));
      await db.exec(`
        INSERT INTO tenants (id, name, domain, country, email, plan, "planStart", "planEnd") VALUES
          ('${A}', 'A', 'a.example', 'X', 'a@example.com', 'BASIC', now(), now()),
          ('${B}', 'B', 'b.example', 'X', 'b@example.com', 'BASIC', now(), now()),
          ('${C}', 'C', 'c.example', 'X', 'c@example.com', 'BASIC', now(), now());
        INSERT INTO storage_files (id, "tenantId", name, key, "mimeType", size)
        VALUES ('${FILE_B}', '${B}', 'logo.png', 'b/logo.png', 'image/png', 1);
        UPDATE tenants SET "logoId" = '${FILE_B}' WHERE id IN ('${A}', '${B}');
        UPDATE tenants SET "logoId" = gen_random_uuid() WHERE id = '${C}';
        INSERT INTO users (id, "tenantId", name, email, password, role, "avatarId") VALUES
          ('a1111111-1111-4111-8111-111111111111', '${A}', 'ua', 'ua@example.com', 'x', 'USER', '${FILE_B}'),
          ('b1111111-1111-4111-8111-111111111111', '${B}', 'ub', 'ub@example.com', 'x', 'USER', '${FILE_B}');
      `);

      await apply(db, tagStartingWith("0014_"));
      await apply(db, tagStartingWith("0015_"));

      const logos = await db.query<{ id: string; logoId: string | null }>(
        'SELECT id, "logoId" FROM tenants ORDER BY name',
      );
      expect(logos.rows).toEqual([
        { id: A, logoId: null },
        { id: B, logoId: FILE_B },
        { id: C, logoId: null },
      ]);
      const avatars = await db.query<{ name: string; avatarId: string | null }>(
        'SELECT name, "avatarId" FROM users ORDER BY name',
      );
      expect(avatars.rows).toEqual([
        { name: "ua", avatarId: null },
        { name: "ub", avatarId: FILE_B },
      ]);

      let failure: unknown = null;
      try {
        await db.exec(
          `UPDATE tenants SET "logoId" = gen_random_uuid() WHERE id = '${A}'`,
        );
      } catch (err) {
        failure = err;
      }
      expect(failure).toMatchObject({ code: "23503" });
    } finally {
      await db.close();
    }
  });
});
