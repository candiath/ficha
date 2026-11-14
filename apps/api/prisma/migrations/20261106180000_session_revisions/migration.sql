-- Session revisions (docs/specs/SPEC-clinical-revisions.md, rollout step 2).
-- A new, empty table: nothing here changes a row.
--
-- Every write to a session stores a snapshot of its new state here, in the same
-- transaction as the write and its audit row. The composite keys keep a version
-- inside its clinic and patient, and RESTRICT keeps the session and the audit
-- row it names from being deleted. Pinned by audit-guards.sql.

-- CreateTable
CREATE TABLE "session_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "reason_note" TEXT,

    CONSTRAINT "session_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "session_revisions_version_positive" CHECK ("version" >= 1)
);

-- CreateIndex
CREATE INDEX "session_revisions_tenant_id_idx" ON "session_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "session_revisions_audit_log_id_idx" ON "session_revisions"("audit_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_revisions_session_id_version_key" ON "session_revisions"("session_id", "version");

-- AddForeignKey
ALTER TABLE "session_revisions" ADD CONSTRAINT "session_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "session_revisions" ADD CONSTRAINT "session_revisions_tenant_id_patient_id_session_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "session_id") REFERENCES "sessions"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "session_revisions" ADD CONSTRAINT "session_revisions_tenant_id_patient_id_audit_log_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "audit_log_id") REFERENCES "audit_logs"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Append-only, with the audit tables' own function: UPDATE and TRUNCATE are
-- always rejected, DELETE outside maintenance. Neither fires on INSERT, so a
-- restore loads this table with its triggers on.
CREATE TRIGGER session_revisions_append_only BEFORE UPDATE OR DELETE ON public.session_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER session_revisions_no_truncate BEFORE TRUNCATE ON public.session_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
