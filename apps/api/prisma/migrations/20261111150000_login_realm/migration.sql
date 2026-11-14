-- The account brake counts per realm and key: a successful clinic login no
-- longer clears a streak of failed operator logins with the same email. The
-- key is the email for a login, and the credential for a change-password's
-- current password. Rows written before this migration were all logins: their
-- key is their email, and the operator's keep her realm.

-- CreateEnum
CREATE TYPE "LoginRealm" AS ENUM ('CLINIC', 'PLATFORM', 'CLINIC_PASSWORD_CHANGE', 'PLATFORM_PASSWORD_CHANGE');

-- AlterTable
ALTER TABLE "login_events" ADD COLUMN "realm" "LoginRealm" NOT NULL DEFAULT 'CLINIC',
ADD COLUMN "key" TEXT;
UPDATE "login_events" SET "key" = "email";
ALTER TABLE "login_events" ALTER COLUMN "key" SET NOT NULL;

-- An attempt at the operator's login against her email names her, success or
-- not. Failures against unknown emails stay CLINIC: the 15-minute window they
-- would count in is long gone.
UPDATE "login_events" SET "realm" = 'PLATFORM' WHERE "operator_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "login_events_realm_key_created_at_idx" ON "login_events"("realm", "key", "created_at");
