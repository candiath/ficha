-- The document that identifies a patient: a type and a number, both or
-- neither (optional: a newborn has none yet). One patient per document in a
-- clinic, deleted patients included: a duplicate could never be merged
-- afterwards, since clinical rows do not move between patients.
--
-- Adding nullable columns writes no existing row, so the versioned table's
-- history is untouched (tests/historyMigrationScan.test.ts).

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DNI', 'PASSPORT', 'FOREIGN_ID', 'OTHER');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "document_number" TEXT,
ADD COLUMN     "document_type" "DocumentType";

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_document_type_document_number_key" ON "patients"("tenant_id", "document_type", "document_number");

-- Both or neither, and the number in the canonical form the API stores
-- (packages/shared patientDocument.ts): the unique key compares text, so a
-- write path that skipped the normalization must fail here, not slip a
-- duplicate past it. A DNI is its digits; any other document, capitals,
-- digits and hyphens.
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_document_type_and_number" CHECK (("document_type" IS NULL) = ("document_number" IS NULL)),
  ADD CONSTRAINT "patients_document_number_normalized" CHECK (
    "document_number" IS NULL
    OR ("document_type" = 'DNI' AND "document_number" ~ '^[0-9]{6,9}$')
    OR ("document_type" <> 'DNI' AND "document_number" ~ '^[A-Z0-9-]{3,30}$')
  );
