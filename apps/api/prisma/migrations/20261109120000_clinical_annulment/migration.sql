-- Sessions and patient events are annulled, not deleted
-- (SPEC-clinical-revisions.md §8): two actions. SESSION_DELETED and
-- PATIENT_EVENT_DELETED stay in the enum, deprecated in the catalog, for the
-- rows that name them. The scan of migrations allows ADD VALUE on the audit
-- enums (a code is only ever added). Nothing here changes a row.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_ANNULLED';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_EVENT_ANNULLED';
