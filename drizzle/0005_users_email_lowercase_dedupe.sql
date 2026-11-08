-- Custom SQL migration file, put your code below! --
-- [SEC-21] E-mail addresses become case-insensitive.
--
-- De-duplication rule (runs BEFORE the unique index on lower(email) is
-- created by the next migration):
--   * active users are grouped by lower(trim(email));
--   * in each group the oldest row (createdAt, then id) is kept;
--   * every other row of the group is soft-deleted (isDeleted = true,
--     deletedAt = now()); its id is reported with RAISE NOTICE so the
--     operator can review it (addresses are not printed).
-- Then every stored address is trimmed and lower-cased.
--
-- The schema owner is subject to FORCE ROW LEVEL SECURITY, so the policy
-- bypass is enabled for this transaction.
SELECT set_config('app.bypass_rls', 'on', true);
--> statement-breakpoint
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM (
      SELECT id,
        row_number() OVER (
          PARTITION BY lower(trim(email))
          ORDER BY "createdAt", id
        ) AS rn
      FROM users
      WHERE "isDeleted" = false
    ) ranked
    WHERE rn > 1
  LOOP
    UPDATE users SET "isDeleted" = true, "deletedAt" = now() WHERE id = r.id;
    RAISE NOTICE 'SEC-21: soft-deleted duplicate user %', r.id;
  END LOOP;
END
$$;
--> statement-breakpoint
UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));
