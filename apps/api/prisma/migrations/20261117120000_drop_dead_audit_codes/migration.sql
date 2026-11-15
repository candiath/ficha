-- The audit codes that no code writes any more, removed before the relaunch,
-- while production holds only the platform operator and every other
-- environment holds test data. After the relaunch a code is permanent (its rows
-- exist), so this is the last time they can go.
--
--   AuditAction:     CREATED, UPDATED, DELETED (the format before the catalog),
--                    SCALE_APPLIED (the functional scales, removed 2026-10-27),
--                    SESSION_DELETED and PATIENT_EVENT_DELETED (replaced by the
--                    annulment actions).
--   AuditEntity:     SCALE.
--   PlatformAction:  USER_ACTIVE_CHANGED (split into USER_DEACTIVATED and
--                    USER_REACTIVATED).
--
-- Postgres cannot drop an enum value, so each type is recreated: a new type
-- with the values that stay, the column switched to it through text, the old
-- type dropped and the new one given its name. Both audit tables are append-only
-- through row triggers, which a column type change does not fire (it rewrites
-- the table, it does not UPDATE its rows). Before each switch a check fails the
-- migration if any row still holds a removed value, so a row can never be lost
-- or silently rewritten: if one exists, this migration stops and nothing is
-- applied (Postgres runs it in one transaction).
--
-- The scan of migrations over the audit tables (tests/auditMigrationScan.test.ts)
-- lists exactly the statements this one is allowed to run.

-- audit_logs.action: AuditAction
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "audit_logs" WHERE "action"::text IN ('CREATED', 'UPDATED', 'DELETED', 'SCALE_APPLIED', 'SESSION_DELETED', 'PATIENT_EVENT_DELETED');
  IF n > 0 THEN
    RAISE EXCEPTION '% row(s) of audit_logs still use a removed AuditAction value: not recreating the type', n;
  END IF;
END $$;

CREATE TYPE "AuditAction_new" AS ENUM (
  'PATIENT_CREATED',
  'PATIENT_UPDATED',
  'PATIENT_DELETED',
  'PATIENT_RESTORED',
  'EVALUATION_CREATED',
  'EVALUATION_UPDATED',
  'SESSION_RECORDED',
  'NOTE_RECORDED',
  'DISCHARGE_RECORDED',
  'SESSION_UPDATED',
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'CONSENT_SIGNED',
  'CONSENT_REVOKED',
  'PATIENT_EVENT_RECORDED',
  'PATIENT_EVENT_UPDATED',
  'EPISODE_OPENED',
  'EPISODE_CLOSED',
  'EPISODE_REOPENED',
  'EPISODE_UPDATED',
  'APPOINTMENT_SCHEDULED',
  'APPOINTMENT_CANCELLED',
  'APPOINTMENT_UPDATED',
  'PACKAGE_CREATED',
  'PACKAGE_DELETED',
  'SESSION_ANNULLED',
  'PATIENT_EVENT_ANNULLED'
);
ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "AuditAction_new" USING "action"::text::"AuditAction_new";
DROP TYPE "AuditAction";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";

-- audit_logs.entity: AuditEntity
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "audit_logs" WHERE "entity"::text IN ('SCALE');
  IF n > 0 THEN
    RAISE EXCEPTION '% row(s) of audit_logs still use a removed AuditEntity value: not recreating the type', n;
  END IF;
END $$;

CREATE TYPE "AuditEntity_new" AS ENUM (
  'PATIENT',
  'EVALUATION',
  'SESSION',
  'PAYMENT',
  'CONSENT',
  'PATIENT_EVENT',
  'EPISODE',
  'APPOINTMENT',
  'PACKAGE'
);
ALTER TABLE "audit_logs" ALTER COLUMN "entity" TYPE "AuditEntity_new" USING "entity"::text::"AuditEntity_new";
DROP TYPE "AuditEntity";
ALTER TYPE "AuditEntity_new" RENAME TO "AuditEntity";

-- platform_audit_logs.action: PlatformAction
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "platform_audit_logs" WHERE "action"::text IN ('USER_ACTIVE_CHANGED');
  IF n > 0 THEN
    RAISE EXCEPTION '% row(s) of platform_audit_logs still use a removed PlatformAction value: not recreating the type', n;
  END IF;
END $$;

CREATE TYPE "PlatformAction_new" AS ENUM (
  'TENANT_CREATED',
  'TENANT_DEACTIVATED',
  'TENANT_REACTIVATED',
  'ADMIN_CREATED',
  'USER_ROLE_CHANGED',
  'USER_DEVICES_DISCONNECTED',
  'PASSWORD_RESET_LINK_CREATED',
  'INVITATION_LINK_CREATED',
  'TEST_ALERT_SENT',
  'USER_DEACTIVATED',
  'USER_REACTIVATED'
);
ALTER TABLE "platform_audit_logs" ALTER COLUMN "action" TYPE "PlatformAction_new" USING "action"::text::"PlatformAction_new";
DROP TYPE "PlatformAction";
ALTER TYPE "PlatformAction_new" RENAME TO "PlatformAction";
