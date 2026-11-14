-- Prerequisites of clinical-revisions (docs/specs/SPEC-clinical-revisions.md,
-- rollout step 1). Nothing here changes a row.
--
-- 1. Episodes are audited: four actions and one entity. The scan of migrations
--    allows ADD VALUE on the audit enums (a code is only ever added).
-- 2. Unique keys on (tenant_id, patient_id, id), for the composite foreign keys
--    of the revisions tables (§2): a version can only name an audit row, an
--    evaluation, a consent or a patient event of its own clinic and patient.
--    Each id is already a primary key, so no existing row can violate them.
--    The one on audit_logs is pinned by audit-guards.sql.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EPISODE_OPENED';
ALTER TYPE "AuditAction" ADD VALUE 'EPISODE_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'EPISODE_REOPENED';
ALTER TYPE "AuditAction" ADD VALUE 'EPISODE_UPDATED';

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'EPISODE';

-- CreateIndex
CREATE UNIQUE INDEX "patient_events_tenant_id_patient_id_id_key" ON "patient_events"("tenant_id", "patient_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "initial_evaluations_tenant_id_patient_id_id_key" ON "initial_evaluations"("tenant_id", "patient_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "informed_consents_tenant_id_patient_id_id_key" ON "informed_consents"("tenant_id", "patient_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_tenant_id_patient_id_id_key" ON "audit_logs"("tenant_id", "patient_id", "id");
