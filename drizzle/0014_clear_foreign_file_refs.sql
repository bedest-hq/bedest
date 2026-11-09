-- Custom SQL migration file, put your code below! --
-- [SEC-27] A tenant's logo and a user's avatar must be files of that
-- tenant. Foreign keys are not subject to RLS, so references to another
-- tenant's file (or to no file at all) could be stored. Runs BEFORE the
-- next migration adds the tenants.logoId foreign key:
--   * tenants.logoId that names no file, or a file of another tenant,
--     is cleared;
--   * users.avatarId that names a file of another tenant is cleared
--     (users.avatarId already has a foreign key).
-- The number of cleared values is reported with RAISE NOTICE.
--
-- The schema owner is subject to FORCE ROW LEVEL SECURITY, so the policy
-- bypass is enabled for this transaction.
SELECT set_config('app.bypass_rls', 'on', true);
--> statement-breakpoint
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE "tenants" t
  SET "logoId" = NULL
  WHERE t."logoId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "storage_files" s
      WHERE s."id" = t."logoId" AND s."tenantId" = t."id"
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'SEC-27: cleared % tenants.logoId value(s)', n;
  END IF;

  UPDATE "users" u
  SET "avatarId" = NULL
  WHERE u."avatarId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "storage_files" s
      WHERE s."id" = u."avatarId" AND s."tenantId" = u."tenantId"
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'SEC-27: cleared % users.avatarId value(s)', n;
  END IF;
END $$;
