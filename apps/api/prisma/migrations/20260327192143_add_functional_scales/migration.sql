-- CreateEnum
CREATE TYPE "ScaleType" AS ENUM ('OSWESTRY', 'NDI');

-- CreateTable
CREATE TABLE "functional_scales" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "scale_type" "ScaleType" NOT NULL,
    "responses" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "interpretation" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "functional_scales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "functional_scales_tenant_id_idx" ON "functional_scales"("tenant_id");

-- CreateIndex
CREATE INDEX "functional_scales_patient_id_idx" ON "functional_scales"("patient_id");

-- CreateIndex
CREATE INDEX "functional_scales_applied_at_idx" ON "functional_scales"("applied_at");

-- AddForeignKey
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
