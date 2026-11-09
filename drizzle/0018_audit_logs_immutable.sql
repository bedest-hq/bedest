-- Custom SQL migration file, put your code below! --
-- [FEAT-13] Audit rows are append-only. Besides the grants (the
-- application role has SELECT and INSERT only), a trigger refuses UPDATE
-- and DELETE for every role — the schema owner included — unless the
-- transaction opted in with
--   SELECT set_config('app.audit_maintenance', 'on', true);
-- which only maintenance code does (RedactAuditLogs, a retention job).
CREATE OR REPLACE FUNCTION system_audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'system_audit_logs is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER system_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON system_audit_logs
  FOR EACH ROW EXECUTE FUNCTION system_audit_logs_immutable();
