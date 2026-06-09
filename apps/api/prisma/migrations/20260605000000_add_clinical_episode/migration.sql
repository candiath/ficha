-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('ACTIVE', 'DISCHARGED', 'ABANDONED');

-- CreateTable
CREATE TABLE "clinical_episodes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "main_complaint" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_episodes_tenant_id_idx" ON "clinical_episodes"("tenant_id");
CREATE INDEX "clinical_episodes_patient_id_idx" ON "clinical_episodes"("patient_id");

-- AddForeignKey (clinical_episodes)
ALTER TABLE "clinical_episodes" ADD CONSTRAINT "clinical_episodes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_episodes" ADD CONSTRAINT "clinical_episodes_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn episode_id to all affected tables (nullable for safe data migration)
ALTER TABLE "initial_evaluations" ADD COLUMN "episode_id" TEXT;
ALTER TABLE "sessions"            ADD COLUMN "episode_id" TEXT;
ALTER TABLE "treatment_cycles"    ADD COLUMN "episode_id" TEXT;
ALTER TABLE "functional_scales"   ADD COLUMN "episode_id" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Data migration: create one ClinicalEpisode per patient and link existing data.
-- Uses reason_for_consultation from the evaluation as mainComplaint when available.
-- Creates an episode for every patient so the UI always has an episode context.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "clinical_episodes" (
    "id", "tenant_id", "patient_id", "status",
    "main_complaint", "opened_at", "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::text,
    p."tenant_id",
    p."id",
    'ACTIVE'::"EpisodeStatus",
    ie."reason_for_consultation",
    COALESCE(ie."evaluated_at", p."created_at"),
    NOW(),
    NOW()
FROM "patients" p
LEFT JOIN "initial_evaluations" ie ON ie."patient_id" = p."id";

-- Link initial_evaluations → episode
UPDATE "initial_evaluations" ie
SET    "episode_id" = ce."id"
FROM   "clinical_episodes" ce
WHERE  ce."patient_id" = ie."patient_id";

-- Link sessions → episode
UPDATE "sessions" s
SET    "episode_id" = ce."id"
FROM   "clinical_episodes" ce
WHERE  ce."patient_id" = s."patient_id";

-- Link treatment_cycles → episode
UPDATE "treatment_cycles" tc
SET    "episode_id" = ce."id"
FROM   "clinical_episodes" ce
WHERE  ce."patient_id" = tc."patient_id";

-- Link functional_scales → episode
UPDATE "functional_scales" fs
SET    "episode_id" = ce."id"
FROM   "clinical_episodes" ce
WHERE  ce."patient_id" = fs."patient_id";

-- CreateIndex (unique + regular)
CREATE UNIQUE INDEX "initial_evaluations_episode_id_key" ON "initial_evaluations"("episode_id");
CREATE INDEX "sessions_episode_id_idx"         ON "sessions"("episode_id");
CREATE INDEX "treatment_cycles_episode_id_idx" ON "treatment_cycles"("episode_id");
CREATE INDEX "functional_scales_episode_id_idx" ON "functional_scales"("episode_id");

-- AddForeignKey (episode_id columns)
ALTER TABLE "initial_evaluations" ADD CONSTRAINT "initial_evaluations_episode_id_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_episode_id_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_episode_id_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_episode_id_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
