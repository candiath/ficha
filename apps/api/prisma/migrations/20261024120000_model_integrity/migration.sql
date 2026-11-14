-- The model's integrity in the database, before the relaunch (#238), while
-- production holds only the clinic's trial and is wiped next.
--
-- 1. evaluation_photos and session_photos go: nothing reads or writes them,
--    and they had no tenant_id, outside the tenant guard.
-- 2. Every evaluation belongs to an episode (it is only written from
--    /episodes/:episodeId/evaluation): episode_id is NOT NULL.
-- 3. Foreign keys that carry the clinic and the patient, as session_episodes
--    already does: a row cannot name another clinic's patient or therapist,
--    nor another patient's episode, session or package. A nullable column
--    (MATCH SIMPLE) is checked only when set. Restrict everywhere: none of
--    these rows is deleted for real except a payment, which goes first.
-- 4. CHECKs for what the API already guarantees, so a write path that forgets
--    fails instead of storing it.

-- DropForeignKey
ALTER TABLE "clinical_episodes" DROP CONSTRAINT "clinical_episodes_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "initial_evaluations" DROP CONSTRAINT "initial_evaluations_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "initial_evaluations" DROP CONSTRAINT "initial_evaluations_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "evaluation_photos" DROP CONSTRAINT "evaluation_photos_initial_evaluation_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "session_photos" DROP CONSTRAINT "session_photos_session_id_fkey";

-- DropForeignKey
ALTER TABLE "session_packages" DROP CONSTRAINT "session_packages_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_session_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_package_id_fkey";

-- DropForeignKey
ALTER TABLE "informed_consents" DROP CONSTRAINT "informed_consents_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_alerts" DROP CONSTRAINT "clinical_alerts_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "functional_scales" DROP CONSTRAINT "functional_scales_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "functional_scales" DROP CONSTRAINT "functional_scales_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_session_id_fkey";

-- AlterTable
ALTER TABLE "initial_evaluations" ALTER COLUMN "episode_id" SET NOT NULL;

-- DropTable
DROP TABLE "evaluation_photos";

-- DropTable
DROP TABLE "session_photos";

-- CreateIndex
CREATE UNIQUE INDEX "initial_evaluations_tenant_id_patient_id_episode_id_key" ON "initial_evaluations"("tenant_id", "patient_id", "episode_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_packages_tenant_id_patient_id_id_key" ON "session_packages"("tenant_id", "patient_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_patient_id_session_id_key" ON "payments"("tenant_id", "patient_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "informed_consents_tenant_id_patient_id_key" ON "informed_consents"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_patient_id_session_id_key" ON "appointments"("tenant_id", "patient_id", "session_id");

-- AddForeignKey
ALTER TABLE "clinical_episodes" ADD CONSTRAINT "clinical_episodes_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "initial_evaluations" ADD CONSTRAINT "initial_evaluations_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "initial_evaluations" ADD CONSTRAINT "initial_evaluations_tenant_id_patient_id_episode_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "episode_id") REFERENCES "clinical_episodes"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "session_packages" ADD CONSTRAINT "session_packages_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_patient_id_session_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "session_id") REFERENCES "sessions"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_patient_id_package_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "package_id") REFERENCES "session_packages"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "informed_consents" ADD CONSTRAINT "informed_consents_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "clinical_alerts" ADD CONSTRAINT "clinical_alerts_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_tenant_id_patient_id_episode_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "episode_id") REFERENCES "clinical_episodes"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_episode_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "episode_id") REFERENCES "clinical_episodes"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_patient_id_session_id_fkey" FOREIGN KEY ("tenant_id", "patient_id", "session_id") REFERENCES "sessions"("tenant_id", "patient_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- CHECKs (4)
ALTER TABLE "session_episodes"
  ADD CONSTRAINT "session_episodes_pain_before_range" CHECK ("pain_scale_before" BETWEEN 0 AND 10),
  ADD CONSTRAINT "session_episodes_pain_after_range" CHECK ("pain_scale_after" BETWEEN 0 AND 10);

ALTER TABLE "initial_evaluations"
  ADD CONSTRAINT "initial_evaluations_eva_range" CHECK ("eva_scale" BETWEEN 0 AND 10);

ALTER TABLE "functional_scales"
  ADD CONSTRAINT "functional_scales_score_range" CHECK ("score" BETWEEN 0 AND 100);

-- Not final_amount = base_amount - discount: the API computes it in floating
-- point before the column rounds it to cents, so equality could reject a valid
-- write. Rounding keeps order, so these hold.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_not_negative" CHECK ("base_amount" >= 0 AND "discount" >= 0 AND "final_amount" >= 0),
  ADD CONSTRAINT "payments_discount_within_base" CHECK ("discount" <= "base_amount");

-- price >= 0 and not > 0: the API asks for a positive price, but a fraction
-- of a cent rounds to 0.00.
ALTER TABLE "session_packages"
  ADD CONSTRAINT "session_packages_total_sessions_positive" CHECK ("total_sessions" >= 1),
  ADD CONSTRAINT "session_packages_price_not_negative" CHECK ("price_per_session" >= 0);

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_ends_after_start" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "appointments_cancelled_has_date" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

-- Open exactly when it has no closing date. Not closed_at >= opened_at: a
-- discharge closes the episode at the current time, and opened_at may be
-- slightly in the future.
ALTER TABLE "clinical_episodes"
  ADD CONSTRAINT "clinical_episodes_closed_has_date" CHECK (("status" = 'ACTIVE') = ("closed_at" IS NULL));
