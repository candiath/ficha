-- One audit action per business fact (#186, docs/specs/SPEC-audit-structured-entries.md):
-- the codes of the catalog in packages/shared/src/auditActions.ts. CREATED,
-- UPDATED, DELETED and USER_ACTIVE_CHANGED stay, deprecated: old rows have them,
-- and a code is never removed.
--
-- Its own migration: Postgres does not allow a value added by ADD VALUE to be
-- used in the same transaction, and the next migration's defaults and checks
-- are written against these types.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'EVALUATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'EVALUATION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SCALE_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTE_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'DISCHARGE_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONSENT_SIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'CONSENT_REVOKED';

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'SCALE';

-- AlterEnum
ALTER TYPE "PlatformAction" ADD VALUE 'USER_DEACTIVATED';
ALTER TYPE "PlatformAction" ADD VALUE 'USER_REACTIVATED';
