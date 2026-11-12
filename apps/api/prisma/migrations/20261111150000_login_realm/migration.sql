-- The account brake counts per realm and email: a successful clinic login
-- no longer clears a streak of failed operator logins with the same email.
-- Rows written before this migration by the operator's login keep its realm.

-- CreateEnum
CREATE TYPE "LoginRealm" AS ENUM ('CLINIC', 'PLATFORM', 'CLINIC_PASSWORD_CHANGE', 'PLATFORM_PASSWORD_CHANGE');

-- AlterTable
ALTER TABLE "login_events" ADD COLUMN "realm" "LoginRealm" NOT NULL DEFAULT 'CLINIC';

-- An attempt at the operator's login against her email names her, success or
-- not. Failures against unknown emails stay CLINIC: the 15-minute window they
-- would count in is long gone.
UPDATE "login_events" SET "realm" = 'PLATFORM' WHERE "operator_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "login_events_realm_email_created_at_idx" ON "login_events"("realm", "email", "created_at");
