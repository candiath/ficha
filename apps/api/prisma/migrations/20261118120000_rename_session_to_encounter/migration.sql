-- Renames the clinical Session to Encounter and SessionEpisode to
-- EncounterBlock, before the relaunch makes the names permanent. Only renames:
-- no table, column or row is dropped or rewritten, so it is also correct on a
-- database that holds rows. Login sessions (auth_sessions,
-- platform_operator_sessions, audit_logs.auth_session_id and its trigger) and
-- session_packages keep their names.
--
-- The NOT NULL constraints that Postgres 18 names after their column (such as
-- sessions_session_date_not_null) are left alone: Prisma ignores them, and
-- earlier Postgres versions have no such constraints to rename.

-- Enums --------------------------------------------------------------------
ALTER TYPE "SessionType" RENAME TO "EncounterType";
ALTER TYPE "AuditEntity" RENAME VALUE 'SESSION' TO 'ENCOUNTER';
ALTER TYPE "AuditAction" RENAME VALUE 'SESSION_RECORDED' TO 'ENCOUNTER_RECORDED';
ALTER TYPE "AuditAction" RENAME VALUE 'SESSION_UPDATED' TO 'ENCOUNTER_UPDATED';
ALTER TYPE "AuditAction" RENAME VALUE 'SESSION_ANNULLED' TO 'ENCOUNTER_ANNULLED';

-- sessions -> encounters -----------------------------------------------------
ALTER TABLE "sessions" RENAME TO "encounters";
ALTER TABLE "encounters" RENAME COLUMN "session_date" TO "encounter_date";
ALTER TABLE "encounters" RENAME COLUMN "session_type" TO "encounter_type";
ALTER INDEX "sessions_pkey" RENAME TO "encounters_pkey";
ALTER INDEX "sessions_patient_id_idx" RENAME TO "encounters_patient_id_idx";
ALTER INDEX "sessions_tenant_id_idx" RENAME TO "encounters_tenant_id_idx";
ALTER INDEX "sessions_tenant_id_patient_id_id_key" RENAME TO "encounters_tenant_id_patient_id_id_key";
ALTER TABLE "encounters" RENAME CONSTRAINT "sessions_tenant_id_fkey" TO "encounters_tenant_id_fkey";
ALTER TABLE "encounters" RENAME CONSTRAINT "sessions_tenant_id_patient_id_fkey" TO "encounters_tenant_id_patient_id_fkey";
ALTER TABLE "encounters" RENAME CONSTRAINT "sessions_tenant_id_user_id_fkey" TO "encounters_tenant_id_user_id_fkey";

-- session_episodes -> encounter_blocks ---------------------------------------
ALTER TABLE "session_episodes" RENAME TO "encounter_blocks";
ALTER TABLE "encounter_blocks" RENAME COLUMN "session_id" TO "encounter_id";
ALTER TABLE "encounter_blocks" RENAME COLUMN "pre_session_state" TO "pre_encounter_state";
ALTER INDEX "session_episodes_pkey" RENAME TO "encounter_blocks_pkey";
ALTER INDEX "session_episodes_episode_id_idx" RENAME TO "encounter_blocks_episode_id_idx";
ALTER INDEX "session_episodes_tenant_id_idx" RENAME TO "encounter_blocks_tenant_id_idx";
ALTER TABLE "encounter_blocks" RENAME CONSTRAINT "session_episodes_pain_after_range" TO "encounter_blocks_pain_after_range";
ALTER TABLE "encounter_blocks" RENAME CONSTRAINT "session_episodes_pain_before_range" TO "encounter_blocks_pain_before_range";
ALTER TABLE "encounter_blocks" RENAME CONSTRAINT "session_episodes_tenant_id_fkey" TO "encounter_blocks_tenant_id_fkey";
ALTER TABLE "encounter_blocks" RENAME CONSTRAINT "session_episodes_tenant_id_patient_id_episode_id_fkey" TO "encounter_blocks_tenant_id_patient_id_episode_id_fkey";
ALTER TABLE "encounter_blocks" RENAME CONSTRAINT "session_episodes_tenant_id_patient_id_session_id_fkey" TO "encounter_blocks_tenant_id_patient_id_encounter_id_fkey";

-- session_revisions -> encounter_revisions (append-only, pinned by
-- prisma/audit-guards.sql; the trigger functions are shared and do not name
-- the table, so only the table, trigger and constraint names change) --------
ALTER TABLE "session_revisions" RENAME TO "encounter_revisions";
ALTER TABLE "encounter_revisions" RENAME COLUMN "session_id" TO "encounter_id";
ALTER INDEX "session_revisions_pkey" RENAME TO "encounter_revisions_pkey";
ALTER INDEX "session_revisions_audit_log_id_idx" RENAME TO "encounter_revisions_audit_log_id_idx";
ALTER INDEX "session_revisions_session_id_version_key" RENAME TO "encounter_revisions_encounter_id_version_key";
ALTER INDEX "session_revisions_tenant_id_idx" RENAME TO "encounter_revisions_tenant_id_idx";
ALTER TABLE "encounter_revisions" RENAME CONSTRAINT "session_revisions_tenant_id_fkey" TO "encounter_revisions_tenant_id_fkey";
ALTER TABLE "encounter_revisions" RENAME CONSTRAINT "session_revisions_tenant_id_patient_id_audit_log_id_fkey" TO "encounter_revisions_tenant_id_patient_id_audit_log_id_fkey";
ALTER TABLE "encounter_revisions" RENAME CONSTRAINT "session_revisions_tenant_id_patient_id_session_id_fkey" TO "encounter_revisions_tenant_id_patient_id_encounter_id_fkey";
ALTER TABLE "encounter_revisions" RENAME CONSTRAINT "session_revisions_version_positive" TO "encounter_revisions_version_positive";
ALTER TRIGGER "session_revisions_append_only" ON "encounter_revisions" RENAME TO "encounter_revisions_append_only";
ALTER TRIGGER "session_revisions_no_truncate" ON "encounter_revisions" RENAME TO "encounter_revisions_no_truncate";

-- payments.session_id -> encounter_id ---------------------------------------
ALTER TABLE "payments" RENAME COLUMN "session_id" TO "encounter_id";
ALTER INDEX "payments_session_id_idx" RENAME TO "payments_encounter_id_idx";
ALTER INDEX "payments_session_id_key" RENAME TO "payments_encounter_id_key";
ALTER INDEX "payments_tenant_id_patient_id_session_id_key" RENAME TO "payments_tenant_id_patient_id_encounter_id_key";
ALTER TABLE "payments" RENAME CONSTRAINT "payments_tenant_id_patient_id_session_id_fkey" TO "payments_tenant_id_patient_id_encounter_id_fkey";

-- appointments.session_id -> encounter_id -----------------------------------
ALTER TABLE "appointments" RENAME COLUMN "session_id" TO "encounter_id";
ALTER INDEX "appointments_session_id_key" RENAME TO "appointments_encounter_id_key";
ALTER INDEX "appointments_tenant_id_patient_id_session_id_key" RENAME TO "appointments_tenant_id_patient_id_encounter_id_key";
ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_tenant_id_patient_id_session_id_fkey" TO "appointments_tenant_id_patient_id_encounter_id_fkey";
