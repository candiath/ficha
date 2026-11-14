-- A deleted patient can be restored: one action. Nothing here changes a row.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_RESTORED';
