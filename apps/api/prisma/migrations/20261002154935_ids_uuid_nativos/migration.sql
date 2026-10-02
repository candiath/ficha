-- Ids: text → uuid nativo (issue #174).
--
-- Escrita a mano. Lo que genera Prisma para este cambio es DROP COLUMN + ADD
-- COLUMN por cada id: con datos, borra todos los ids y rompe cada relación
-- (o falla por el NOT NULL sin default). Esto, en cambio, convierte en el
-- lugar con ALTER COLUMN ... TYPE uuid USING ...::uuid, que conserva los
-- valores. Postgres reconstruye solo las PK, los UNIQUE y los índices de cada
-- columna, con los mismos nombres, así que el resultado es idéntico al schema.
--
-- Precondición: todo valor de estas columnas tiene que ser un uuid válido, o
-- el cast falla. Verificado el 02/10/2026 en production y staging (todos los
-- ids salieron de @default(uuid())). Los ids legibles del seed (dev-*) no lo
-- cumplen: development se vació antes de aplicarla.
--
-- Va en una transacción explícita (Prisma no envuelve las migraciones): si un
-- cast falla, no queda la base a medio convertir y sin FKs.

BEGIN;

-- 1. Las FK se sueltan primero: una FK exige el mismo tipo en las dos puntas,
--    y no se puede cambiar una punta sin la otra.
-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_session_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_alerts" DROP CONSTRAINT "clinical_alerts_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_alerts" DROP CONSTRAINT "clinical_alerts_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_episodes" DROP CONSTRAINT "clinical_episodes_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_episodes" DROP CONSTRAINT "clinical_episodes_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "evaluation_photos" DROP CONSTRAINT "evaluation_photos_initial_evaluation_id_fkey";

-- DropForeignKey
ALTER TABLE "functional_scales" DROP CONSTRAINT "functional_scales_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "functional_scales" DROP CONSTRAINT "functional_scales_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "functional_scales" DROP CONSTRAINT "functional_scales_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "informed_consents" DROP CONSTRAINT "informed_consents_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "informed_consents" DROP CONSTRAINT "informed_consents_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "initial_evaluations" DROP CONSTRAINT "initial_evaluations_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "initial_evaluations" DROP CONSTRAINT "initial_evaluations_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "initial_evaluations" DROP CONSTRAINT "initial_evaluations_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "login_events" DROP CONSTRAINT "login_events_operator_id_fkey";

-- DropForeignKey
ALTER TABLE "login_events" DROP CONSTRAINT "login_events_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "login_events" DROP CONSTRAINT "login_events_user_id_fkey";

-- DropForeignKey
ALTER TABLE "patients" DROP CONSTRAINT "patients_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_package_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_session_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "platform_audit_logs" DROP CONSTRAINT "platform_audit_logs_operator_id_fkey";

-- DropForeignKey
ALTER TABLE "platform_audit_logs" DROP CONSTRAINT "platform_audit_logs_target_user_id_fkey";

-- DropForeignKey
ALTER TABLE "platform_audit_logs" DROP CONSTRAINT "platform_audit_logs_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "session_episodes" DROP CONSTRAINT "session_episodes_episode_id_fkey";

-- DropForeignKey
ALTER TABLE "session_episodes" DROP CONSTRAINT "session_episodes_session_id_fkey";

-- DropForeignKey
ALTER TABLE "session_packages" DROP CONSTRAINT "session_packages_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "session_packages" DROP CONSTRAINT "session_packages_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "session_photos" DROP CONSTRAINT "session_photos_session_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_patient_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_fkey";

-- 2. Conversión en el lugar. Sin DEFAULT que cambiar: el id lo genera Prisma.

ALTER TABLE "appointments"
  ALTER COLUMN "episode_id" SET DATA TYPE UUID USING "episode_id"::uuid,
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "series_id" SET DATA TYPE UUID USING "series_id"::uuid,
  ALTER COLUMN "session_id" SET DATA TYPE UUID USING "session_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid,
  ALTER COLUMN "user_id" SET DATA TYPE UUID USING "user_id"::uuid;

ALTER TABLE "audit_logs"
  ALTER COLUMN "entity_id" SET DATA TYPE UUID USING "entity_id"::uuid,
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid,
  ALTER COLUMN "user_id" SET DATA TYPE UUID USING "user_id"::uuid;

ALTER TABLE "clinical_alerts"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "clinical_episodes"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "evaluation_photos"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "initial_evaluation_id" SET DATA TYPE UUID USING "initial_evaluation_id"::uuid;

ALTER TABLE "functional_scales"
  ALTER COLUMN "episode_id" SET DATA TYPE UUID USING "episode_id"::uuid,
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "informed_consents"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "initial_evaluations"
  ALTER COLUMN "episode_id" SET DATA TYPE UUID USING "episode_id"::uuid,
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "login_events"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "operator_id" SET DATA TYPE UUID USING "operator_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid,
  ALTER COLUMN "user_id" SET DATA TYPE UUID USING "user_id"::uuid;

ALTER TABLE "patients"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "payments"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "package_id" SET DATA TYPE UUID USING "package_id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "session_id" SET DATA TYPE UUID USING "session_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "platform_audit_logs"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "operator_id" SET DATA TYPE UUID USING "operator_id"::uuid,
  ALTER COLUMN "target_user_id" SET DATA TYPE UUID USING "target_user_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "platform_operators"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid;

ALTER TABLE "session_episodes"
  ALTER COLUMN "episode_id" SET DATA TYPE UUID USING "episode_id"::uuid,
  ALTER COLUMN "session_id" SET DATA TYPE UUID USING "session_id"::uuid;

ALTER TABLE "session_packages"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

ALTER TABLE "session_photos"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "session_id" SET DATA TYPE UUID USING "session_id"::uuid;

ALTER TABLE "sessions"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "patient_id" SET DATA TYPE UUID USING "patient_id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid,
  ALTER COLUMN "user_id" SET DATA TYPE UUID USING "user_id"::uuid;

ALTER TABLE "tenants"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid;

ALTER TABLE "users"
  ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid,
  ALTER COLUMN "tenant_id" SET DATA TYPE UUID USING "tenant_id"::uuid;

-- 3. Las FK vuelven, idénticas a como estaban.
-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_episodes" ADD CONSTRAINT "clinical_episodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_episodes" ADD CONSTRAINT "clinical_episodes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_evaluations" ADD CONSTRAINT "initial_evaluations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_evaluations" ADD CONSTRAINT "initial_evaluations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initial_evaluations" ADD CONSTRAINT "initial_evaluations_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_photos" ADD CONSTRAINT "evaluation_photos_initial_evaluation_id_fkey" FOREIGN KEY ("initial_evaluation_id") REFERENCES "initial_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_episodes" ADD CONSTRAINT "session_episodes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_episodes" ADD CONSTRAINT "session_episodes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_photos" ADD CONSTRAINT "session_photos_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_packages" ADD CONSTRAINT "session_packages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_packages" ADD CONSTRAINT "session_packages_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "session_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "informed_consents" ADD CONSTRAINT "informed_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "informed_consents" ADD CONSTRAINT "informed_consents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_alerts" ADD CONSTRAINT "clinical_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_alerts" ADD CONSTRAINT "clinical_alerts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_scales" ADD CONSTRAINT "functional_scales_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "clinical_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
