-- A session can treat several episodes, each with its own block (#238). What
-- belongs to one problem moves from the session to its block: the pain before
-- and after, the exercises and the re-evaluation.
--
-- Written by hand, to move the values instead of dropping them. Until now the
-- API allowed at most one episode per session, so each session's values go to
-- its one block. A session without an episode has no block to keep them and
-- loses them: only test data has such sessions with values (production is
-- wiped before the relaunch).
--
-- The columns are dropped in this same release, an exception to the
-- two-release rule for destructive migrations: nobody uses the app until the
-- relaunch (#238). The code still serving during the Render build reads the
-- dropped columns, so its session routes fail until the new deploy is live.

-- 1. The block gets its keys and fields, filled from its session.
ALTER TABLE "session_episodes" ADD COLUMN "tenant_id" UUID,
ADD COLUMN     "patient_id" UUID,
ADD COLUMN     "pain_scale_before" INTEGER,
ADD COLUMN     "pain_scale_after" INTEGER,
ADD COLUMN     "patient_exercises" TEXT,
ADD COLUMN     "re_evaluation_notes" TEXT;

UPDATE "session_episodes" AS se
SET "tenant_id" = s."tenant_id",
    "patient_id" = s."patient_id",
    "pain_scale_before" = s."pain_scale_before",
    "pain_scale_after" = s."pain_scale_after",
    "patient_exercises" = s."patient_exercises",
    "re_evaluation_notes" = s."re_evaluation_notes"
FROM "sessions" AS s
WHERE s."id" = se."session_id";

ALTER TABLE "session_episodes" ALTER COLUMN "tenant_id" SET NOT NULL,
ALTER COLUMN "patient_id" SET NOT NULL;

-- 2. A block joins a session and an episode of the same clinic and patient.
-- Restrict instead of cascade: nothing deletes sessions or episodes for real.
-- DropForeignKey
ALTER TABLE "session_episodes" DROP CONSTRAINT "session_episodes_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "session_episodes" DROP CONSTRAINT "session_episodes_session_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "clinical_episodes_tenant_id_patient_id_id_key" ON "clinical_episodes"("tenant_id", "patient_id", "id");

-- CreateIndex
CREATE INDEX "session_episodes_tenant_id_idx" ON "session_episodes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tenant_id_patient_id_id_key" ON "sessions"("tenant_id", "patient_id", "id");

-- AddForeignKey
ALTER TABLE "session_episodes" ADD CONSTRAINT "session_episodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_episodes" ADD CONSTRAINT "session_episodes_tenant_id_patient_id_session_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "session_id") REFERENCES "sessions"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "session_episodes" ADD CONSTRAINT "session_episodes_tenant_id_patient_id_episode_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "episode_id") REFERENCES "clinical_episodes"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 3. The session keeps only what the visit has once.
-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "pain_scale_after",
DROP COLUMN "pain_scale_before",
DROP COLUMN "patient_exercises",
DROP COLUMN "re_evaluation_notes";
