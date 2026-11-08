-- Clinical revisions of the other five aggregates (docs/specs/SPEC-clinical-revisions.md,
-- rollout step 3): patients, episodes, initial evaluations, informed consents and
-- patient events. Five new, empty tables: nothing here changes a row.
--
-- The same shape as session_revisions: every write to one of these aggregates
-- stores a snapshot of its new state here, in the same transaction as the write
-- and its audit row. The composite keys keep a version inside its clinic and
-- patient, and RESTRICT keeps the aggregate and the audit row it names from being
-- deleted. Pinned by audit-guards.sql.

-- CreateTable
CREATE TABLE "patient_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "reason_note" TEXT,

    CONSTRAINT "patient_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_revisions_version_positive" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "episode_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "reason_note" TEXT,

    CONSTRAINT "episode_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "episode_revisions_version_positive" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "evaluation_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "reason_note" TEXT,

    CONSTRAINT "evaluation_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evaluation_revisions_version_positive" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "consent_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "reason_note" TEXT,

    CONSTRAINT "consent_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consent_revisions_version_positive" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "patient_event_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "patient_event_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "audit_log_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "reason_note" TEXT,

    CONSTRAINT "patient_event_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_event_revisions_version_positive" CHECK ("version" >= 1)
);

-- CreateIndex
CREATE INDEX "patient_revisions_tenant_id_idx" ON "patient_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_revisions_audit_log_id_idx" ON "patient_revisions"("audit_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_revisions_patient_id_version_key" ON "patient_revisions"("patient_id", "version");

-- CreateIndex
CREATE INDEX "episode_revisions_tenant_id_idx" ON "episode_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "episode_revisions_audit_log_id_idx" ON "episode_revisions"("audit_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "episode_revisions_episode_id_version_key" ON "episode_revisions"("episode_id", "version");

-- CreateIndex
CREATE INDEX "evaluation_revisions_tenant_id_idx" ON "evaluation_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "evaluation_revisions_audit_log_id_idx" ON "evaluation_revisions"("audit_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_revisions_evaluation_id_version_key" ON "evaluation_revisions"("evaluation_id", "version");

-- CreateIndex
CREATE INDEX "consent_revisions_tenant_id_idx" ON "consent_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "consent_revisions_audit_log_id_idx" ON "consent_revisions"("audit_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_revisions_consent_id_version_key" ON "consent_revisions"("consent_id", "version");

-- CreateIndex
CREATE INDEX "patient_event_revisions_tenant_id_idx" ON "patient_event_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_event_revisions_audit_log_id_idx" ON "patient_event_revisions"("audit_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_event_revisions_patient_event_id_version_key" ON "patient_event_revisions"("patient_event_id", "version");

-- AddForeignKey
ALTER TABLE "patient_revisions" ADD CONSTRAINT "patient_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "patient_revisions" ADD CONSTRAINT "patient_revisions_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "patient_revisions" ADD CONSTRAINT "patient_revisions_tenant_id_patient_id_audit_log_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "audit_log_id") REFERENCES "audit_logs"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "episode_revisions" ADD CONSTRAINT "episode_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "episode_revisions" ADD CONSTRAINT "episode_revisions_tenant_id_patient_id_episode_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "episode_id") REFERENCES "clinical_episodes"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "episode_revisions" ADD CONSTRAINT "episode_revisions_tenant_id_patient_id_audit_log_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "audit_log_id") REFERENCES "audit_logs"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evaluation_revisions" ADD CONSTRAINT "evaluation_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evaluation_revisions" ADD CONSTRAINT "evaluation_revisions_tenant_id_patient_id_evaluation_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "evaluation_id") REFERENCES "initial_evaluations"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "evaluation_revisions" ADD CONSTRAINT "evaluation_revisions_tenant_id_patient_id_audit_log_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "audit_log_id") REFERENCES "audit_logs"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consent_revisions" ADD CONSTRAINT "consent_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consent_revisions" ADD CONSTRAINT "consent_revisions_tenant_id_patient_id_consent_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "consent_id") REFERENCES "informed_consents"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consent_revisions" ADD CONSTRAINT "consent_revisions_tenant_id_patient_id_audit_log_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "audit_log_id") REFERENCES "audit_logs"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "patient_event_revisions" ADD CONSTRAINT "patient_event_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "patient_event_revisions" ADD CONSTRAINT "patient_event_revisions_tenant_id_patient_id_patient_event_fkey" FOREIGN KEY ("tenant_id", "patient_id", "patient_event_id") REFERENCES "patient_events"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "patient_event_revisions" ADD CONSTRAINT "patient_event_revisions_tenant_id_patient_id_audit_log_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "audit_log_id") REFERENCES "audit_logs"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Append-only, with the audit tables' own function: UPDATE and TRUNCATE are
-- always rejected, DELETE outside maintenance. Neither fires on INSERT, so a
-- restore loads these tables with their triggers on.
CREATE TRIGGER patient_revisions_append_only BEFORE UPDATE OR DELETE ON public.patient_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER patient_revisions_no_truncate BEFORE TRUNCATE ON public.patient_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER episode_revisions_append_only BEFORE UPDATE OR DELETE ON public.episode_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER episode_revisions_no_truncate BEFORE TRUNCATE ON public.episode_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER evaluation_revisions_append_only BEFORE UPDATE OR DELETE ON public.evaluation_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER evaluation_revisions_no_truncate BEFORE TRUNCATE ON public.evaluation_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER consent_revisions_append_only BEFORE UPDATE OR DELETE ON public.consent_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER consent_revisions_no_truncate BEFORE TRUNCATE ON public.consent_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER patient_event_revisions_append_only BEFORE UPDATE OR DELETE ON public.patient_event_revisions
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER patient_event_revisions_no_truncate BEFORE TRUNCATE ON public.patient_event_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
