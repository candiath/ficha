-- Appointments and packages are audited (#272): five actions and two entities.
-- The scan of migrations allows ADD VALUE on the audit enums (a code is only
-- ever added). Nothing here changes a row.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_SCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'APPOINTMENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PACKAGE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PACKAGE_DELETED';

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'APPOINTMENT';
ALTER TYPE "AuditEntity" ADD VALUE 'PACKAGE';
