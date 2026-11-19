-- Renames PatientEvent to PatientAntecedent (the record's "Antecedentes")
-- before the relaunch makes the names permanent. Only renames: no table,
-- column or row is dropped or rewritten, so it is also correct on a database
-- that holds rows. login_events and other "event" names are not touched. The
-- NOT NULL constraints Postgres 18 names after their column are left alone
-- (see 20261118120000_rename_session_to_encounter).

-- Enums --------------------------------------------------------------------
ALTER TYPE "PatientEventKind" RENAME TO "PatientAntecedentKind";
ALTER TYPE "AuditEntity" RENAME VALUE 'PATIENT_EVENT' TO 'PATIENT_ANTECEDENT';
ALTER TYPE "AuditAction" RENAME VALUE 'PATIENT_EVENT_RECORDED' TO 'PATIENT_ANTECEDENT_RECORDED';
ALTER TYPE "AuditAction" RENAME VALUE 'PATIENT_EVENT_UPDATED' TO 'PATIENT_ANTECEDENT_UPDATED';
ALTER TYPE "AuditAction" RENAME VALUE 'PATIENT_EVENT_ANNULLED' TO 'PATIENT_ANTECEDENT_ANNULLED';

-- patient_events -> patient_antecedents -------------------------------------
ALTER TABLE "patient_events" RENAME TO "patient_antecedents";
ALTER INDEX "patient_events_pkey" RENAME TO "patient_antecedents_pkey";
ALTER INDEX "patient_events_patient_id_idx" RENAME TO "patient_antecedents_patient_id_idx";
ALTER INDEX "patient_events_tenant_id_idx" RENAME TO "patient_antecedents_tenant_id_idx";
ALTER INDEX "patient_events_tenant_id_patient_id_id_key" RENAME TO "patient_antecedents_tenant_id_patient_id_id_key";
ALTER TABLE "patient_antecedents" RENAME CONSTRAINT "patient_events_tenant_id_fkey" TO "patient_antecedents_tenant_id_fkey";
ALTER TABLE "patient_antecedents" RENAME CONSTRAINT "patient_events_tenant_id_patient_id_fkey" TO "patient_antecedents_tenant_id_patient_id_fkey";
ALTER TABLE "patient_antecedents" RENAME CONSTRAINT "patient_events_approximate_has_date" TO "patient_antecedents_approximate_has_date";
ALTER TABLE "patient_antecedents" RENAME CONSTRAINT "patient_events_date_with_precision" TO "patient_antecedents_date_with_precision";
ALTER TABLE "patient_antecedents" RENAME CONSTRAINT "patient_events_description_present" TO "patient_antecedents_description_present";
ALTER TABLE "patient_antecedents" RENAME CONSTRAINT "patient_events_month_truncated" TO "patient_antecedents_month_truncated";
ALTER TABLE "patient_antecedents" RENAME CONSTRAINT "patient_events_year_truncated" TO "patient_antecedents_year_truncated";

-- patient_event_revisions -> patient_antecedent_revisions (append-only,
-- pinned by prisma/audit-guards.sql; the shared trigger functions do not name
-- the table) ------------------------------------------------------------------
ALTER TABLE "patient_event_revisions" RENAME TO "patient_antecedent_revisions";
ALTER TABLE "patient_antecedent_revisions" RENAME COLUMN "patient_event_id" TO "patient_antecedent_id";
ALTER INDEX "patient_event_revisions_pkey" RENAME TO "patient_antecedent_revisions_pkey";
ALTER INDEX "patient_event_revisions_audit_log_id_idx" RENAME TO "patient_antecedent_revisions_audit_log_id_idx";
ALTER INDEX "patient_event_revisions_patient_event_id_version_key" RENAME TO "patient_antecedent_revisions_patient_antecedent_id_version_key";
ALTER INDEX "patient_event_revisions_tenant_id_idx" RENAME TO "patient_antecedent_revisions_tenant_id_idx";
ALTER TABLE "patient_antecedent_revisions" RENAME CONSTRAINT "patient_event_revisions_tenant_id_fkey" TO "patient_antecedent_revisions_tenant_id_fkey";
ALTER TABLE "patient_antecedent_revisions" RENAME CONSTRAINT "patient_event_revisions_tenant_id_patient_id_audit_log_id_fkey" TO "patient_antecedent_revisions_tenant_id_patient_id_audit_lo_fkey";
ALTER TABLE "patient_antecedent_revisions" RENAME CONSTRAINT "patient_event_revisions_tenant_id_patient_id_patient_event_fkey" TO "patient_antecedent_revisions_tenant_id_patient_id_patient__fkey";
ALTER TABLE "patient_antecedent_revisions" RENAME CONSTRAINT "patient_event_revisions_version_positive" TO "patient_antecedent_revisions_version_positive";
ALTER TRIGGER "patient_event_revisions_append_only" ON "patient_antecedent_revisions" RENAME TO "patient_antecedent_revisions_append_only";
ALTER TRIGGER "patient_event_revisions_no_truncate" ON "patient_antecedent_revisions" RENAME TO "patient_antecedent_revisions_no_truncate";
