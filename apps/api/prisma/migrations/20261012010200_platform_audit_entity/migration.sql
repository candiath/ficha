-- The object a platform action was on (#186, docs/specs/SPEC-audit-structured-entries.md):
-- the reset link generated, the test alert sent. A row then names exactly
-- which link or alert it is about. Actions on a clinic or a user leave both
-- columns empty: tenant_id and target_user_id already name their object, with
-- composite foreign keys.
--
-- No foreign key: entity_id points at a different table by type. The checks
-- that the object exists, is the target's and was made by this operator come
-- in a later release, as an insert trigger. Until then the catalog in
-- packages/shared decides which action takes which entity.
--
-- Adding nullable columns, a CHECK and an index needs no entry in
-- tests/auditMigrationScan.test.ts.

LOCK TABLE public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;

-- CreateEnum
CREATE TYPE "PlatformAuditEntity" AS ENUM ('PASSWORD_RESET_TOKEN', 'SYSADMIN_ALERT');

-- AlterTable
ALTER TABLE "platform_audit_logs" ADD COLUMN "entity" "PlatformAuditEntity",
ADD COLUMN "entity_id" UUID;

ALTER TABLE public.platform_audit_logs
  ADD CONSTRAINT platform_audit_logs_entity_with_id CHECK ((entity IS NULL) = (entity_id IS NULL));

-- One row per action on an object: a link is generated once, an alert sent
-- once. Per action, so a later action on the same object (revoking a link)
-- still fits.
CREATE UNIQUE INDEX platform_audit_logs_action_entity_key
  ON public.platform_audit_logs (action, entity, entity_id)
  WHERE entity IS NOT NULL;
