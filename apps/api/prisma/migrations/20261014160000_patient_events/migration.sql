-- The patient's history ("Antecedentes", #238): what the patient lived, as
-- dated facts. A fracture, a surgery, a diagnosis, the onset of a pain. It
-- belongs to the patient, so it is written once and seen from every episode.
--
-- Its date is partial (packages/shared/src/partialDate.ts): a date truncated
-- to its precision, the precision, and an "approximate" mark. The CHECKs below
-- keep them consistent, so a month is never stored as the 15th and an
-- approximate date always has a date.
--
-- Three audit actions and one audit entity are added: the scan of migrations
-- allows ADD VALUE on the audit enums (a code is only ever added).

-- CreateEnum
CREATE TYPE "PatientEventKind" AS ENUM ('FRACTURE', 'SURGERY', 'TRAUMA', 'DIAGNOSIS', 'PAIN_ONSET', 'OTHER');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('DAY', 'MONTH', 'YEAR');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_EVENT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_EVENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_EVENT_DELETED';

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'PATIENT_EVENT';

-- CreateTable
CREATE TABLE "patient_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" "PatientEventKind" NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_on" DATE,
    "occurred_precision" "DatePrecision",
    "occurred_approximate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_events_pkey" PRIMARY KEY ("id"),
    -- What the event was is required.
    CONSTRAINT "patient_events_description_present" CHECK (btrim("description") <> ''),
    -- A date and its precision come together, or neither does.
    CONSTRAINT "patient_events_date_with_precision" CHECK (("occurred_on" IS NULL) = ("occurred_precision" IS NULL)),
    -- Only a date can be approximate.
    CONSTRAINT "patient_events_approximate_has_date" CHECK ("occurred_on" IS NOT NULL OR NOT "occurred_approximate"),
    -- A month is stored as its first day, a year as its first of January.
    CONSTRAINT "patient_events_month_truncated" CHECK ("occurred_precision" <> 'MONTH' OR EXTRACT(DAY FROM "occurred_on") = 1),
    CONSTRAINT "patient_events_year_truncated" CHECK (
        "occurred_precision" <> 'YEAR' OR (EXTRACT(MONTH FROM "occurred_on") = 1 AND EXTRACT(DAY FROM "occurred_on") = 1)
    )
);

-- CreateIndex
CREATE INDEX "patient_events_tenant_id_idx" ON "patient_events"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_events_patient_id_idx" ON "patient_events"("patient_id");

-- AddForeignKey
ALTER TABLE "patient_events" ADD CONSTRAINT "patient_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_events" ADD CONSTRAINT "patient_events_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
