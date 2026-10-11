-- Sysadmin alerts (#186, docs/specs/SPEC-sysadmin-alerts.md): what the
-- platform operator is told by Telegram, and each delivery attempt. Both
-- tables are audit tables, with the same triggers as platform_audit_logs.
-- And the operator's test alert is recorded in platform_audit_logs, which
-- needs a row with no clinic.
--
-- On the DDL scan's allowlist (tests/auditMigrationScan.test.ts): it creates
-- triggers that call the audit functions, and drops NOT NULL from
-- platform_audit_logs.tenant_id.

-- Every table this migration alters or references, locked up front in the
-- order 20261010191055_audit_rows_enforced used. A request of the code still
-- serving waits for the migration instead of deadlocking with it.
LOCK TABLE public.tenants, public.platform_operators, public.users,
  public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;

-- CreateEnum
CREATE TYPE "SysadminAlertKind" AS ENUM ('AUDIT_GUARDS_FAILED', 'AUDIT_MAINTENANCE_FLAG_PRESENT', 'TEST');

-- CreateEnum
CREATE TYPE "SysadminAlertOutcome" AS ENUM ('SENT', 'REJECTED', 'UNREACHABLE', 'NOT_CONFIGURED');

-- AlterEnum
ALTER TYPE "PlatformAction" ADD VALUE 'TEST_ALERT_SENT';

-- AlterTable
ALTER TABLE "platform_audit_logs" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sysadmin_alerts" (
    "id" UUID NOT NULL,
    "kind" "SysadminAlertKind" NOT NULL,
    "operator_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sysadmin_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sysadmin_alert_deliveries" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "outcome" "SysadminAlertOutcome" NOT NULL,
    "error_code" INTEGER,
    "detail" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sysadmin_alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sysadmin_alerts_created_at_idx" ON "sysadmin_alerts"("created_at");

-- CreateIndex
CREATE INDEX "sysadmin_alert_deliveries_alert_id_created_at_idx" ON "sysadmin_alert_deliveries"("alert_id", "created_at");

-- CreateIndex
CREATE INDEX "sysadmin_alert_deliveries_created_at_idx" ON "sysadmin_alert_deliveries"("created_at");

-- AddForeignKey
ALTER TABLE "sysadmin_alerts" ADD CONSTRAINT "sysadmin_alerts_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sysadmin_alert_deliveries" ADD CONSTRAINT "sysadmin_alert_deliveries_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "sysadmin_alerts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Only an action on the platform itself has no clinic; every other action
-- still names one, so a buggy write cannot drop out of a clinic's audit list.
-- Compared as text: the value was added above, and a value added by ADD VALUE
-- cannot be used as an enum literal before its transaction commits.
ALTER TABLE public.platform_audit_logs ADD CONSTRAINT platform_audit_logs_tenant_only_off_platform
  CHECK ((tenant_id IS NULL) = (action::text = 'TEST_ALERT_SENT'));

-- With tenant_id null, the composite key (tenant_id, target_user_id) is not
-- checked (MATCH SIMPLE). A row with a target always names its clinic.
ALTER TABLE public.platform_audit_logs ADD CONSTRAINT platform_audit_logs_target_needs_tenant
  CHECK (tenant_id IS NOT NULL OR target_user_id IS NULL);

-- A test alert names its operator; nothing else does.
ALTER TABLE public.sysadmin_alerts ADD CONSTRAINT sysadmin_alerts_operator_only_on_tests
  CHECK ((kind = 'TEST') = (operator_id IS NOT NULL));

-- Telegram's error code goes with a rejection, and only with one.
ALTER TABLE public.sysadmin_alert_deliveries ADD CONSTRAINT sysadmin_alert_deliveries_error_code_on_rejected
  CHECK ((outcome = 'REJECTED') = (error_code IS NOT NULL));

-- The same three triggers as platform_audit_logs, on both tables, calling the
-- existing functions (no new function, so no new hash): UPDATE and TRUNCATE
-- always rejected, DELETE only under maintenance, created_at stamped by the
-- database.
CREATE TRIGGER sysadmin_alerts_stamp_created_at BEFORE INSERT ON public.sysadmin_alerts
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_stamp_created_at();
CREATE TRIGGER sysadmin_alerts_append_only BEFORE UPDATE OR DELETE ON public.sysadmin_alerts
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER sysadmin_alerts_no_truncate BEFORE TRUNCATE ON public.sysadmin_alerts
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();

CREATE TRIGGER sysadmin_alert_deliveries_stamp_created_at BEFORE INSERT ON public.sysadmin_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_stamp_created_at();
CREATE TRIGGER sysadmin_alert_deliveries_append_only BEFORE UPDATE OR DELETE ON public.sysadmin_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER sysadmin_alert_deliveries_no_truncate BEFORE TRUNCATE ON public.sysadmin_alert_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
