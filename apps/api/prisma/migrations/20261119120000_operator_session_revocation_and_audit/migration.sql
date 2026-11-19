-- Why an operator session ended, and which operator session wrote each
-- platform audit row (SPEC-operator-sessions.md, SPEC-audit-hardening.md
-- "Decisions" 2). Both before platform_operator_sessions reaches production.

-- CreateEnum
CREATE TYPE "OperatorSessionRevocationReason" AS ENUM ('LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'OPERATOR_DEACTIVATED');

-- Sessions revoked before the reason existed are only on staging, development
-- and ci (the table has not reached production), and hold test logins: they
-- go, rather than a value meaning "unknown" that would stay in the enum.
DELETE FROM "platform_operator_sessions" WHERE "revoked_at" IS NOT NULL;

-- AlterTable
ALTER TABLE "platform_operator_sessions" ADD COLUMN "revocation_reason" "OperatorSessionRevocationReason";

-- A revoked session says why, and only a revoked one has a reason.
ALTER TABLE "platform_operator_sessions" ADD CONSTRAINT "platform_operator_sessions_reason_iff_revoked"
  CHECK (("revoked_at" IS NULL) = ("revocation_reason" IS NULL));

-- AlterTable
ALTER TABLE "platform_audit_logs" ADD COLUMN "operator_session_id" UUID;

-- A session on a platform row is a real session of its operator when the row
-- is written, as audit_logs_check_session does for clinic users. No foreign
-- key: the audit row outlives the session row.
CREATE FUNCTION public.platform_audit_logs_check_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.operator_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.platform_operator_sessions s
    WHERE s.id = NEW.operator_session_id AND s.operator_id = NEW.operator_id
  ) THEN
    RAISE EXCEPTION 'platform audit row names a session that is not its operator''s';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER platform_audit_logs_check_session BEFORE INSERT ON public.platform_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.platform_audit_logs_check_session();
