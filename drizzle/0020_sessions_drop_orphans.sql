-- Custom SQL migration file, put your code below! --
-- [FEAT-05] sessions.userId becomes a foreign key to users.id (next
-- migration). Sessions whose user no longer exists can never be used
-- again; they are deleted first so the constraint can be created. The
-- count is reported with RAISE NOTICE.
SELECT set_config('app.bypass_rls', 'on', true);
--> statement-breakpoint
DO $$
DECLARE
  n integer;
BEGIN
  DELETE FROM "sessions" s
  WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = s."userId");
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'FEAT-05: deleted % session(s) of missing users', n;
  END IF;
END $$;
