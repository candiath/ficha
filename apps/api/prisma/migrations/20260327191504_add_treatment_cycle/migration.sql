-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED');

-- CreateTable
CREATE TABLE "treatment_cycles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "main_chain_id" TEXT,
    "objective" TEXT,
    "target_sessions" INTEGER,
    "reeval_every" INTEGER,
    "discharge_criteria" TEXT,
    "status" "CycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "treatment_cycles_tenant_id_idx" ON "treatment_cycles"("tenant_id");

-- CreateIndex
CREATE INDEX "treatment_cycles_patient_id_idx" ON "treatment_cycles"("patient_id");

-- AddForeignKey
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_main_chain_id_fkey" FOREIGN KEY ("main_chain_id") REFERENCES "muscular_chains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
