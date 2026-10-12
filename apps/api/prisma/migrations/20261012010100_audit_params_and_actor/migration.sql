-- Audit rows as codes (#186, docs/specs/SPEC-audit-structured-entries.md):
-- each row gets its parameters (codes only, never a value) and who acted, and
-- the Spanish description stops being required. Release 2 drops it.
--
-- On the DDL scan's allowlist (tests/auditMigrationScan.test.ts): the two
-- DROP NOT NULL on description. Adding columns with a constant default fills
-- the existing rows without an UPDATE, so the append-only triggers are not
-- involved.

-- Both audit tables, locked up front in the order of
-- 20261010191055_audit_rows_enforced. A request of the code still serving
-- waits for the migration instead of deadlocking with it.
LOCK TABLE public.audit_logs, public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'OPERATOR', 'SYSTEM');

-- What params may hold: an object whose keys are camelCase names and whose
-- values are enum codes (capitals, digits and _, never three digits in a row)
-- or lists of camelCase field names. Amounts, scores, document numbers,
-- emails, ids, dates and sentences cannot pass; a single word in capitals can,
-- and that is the catalog's job. A function, so the check does not depend on
-- how jsonb prints; pinned by hash in prisma/audit-guards.sql.
CREATE FUNCTION public.audit_params_are_codes(p jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  -- The CASE keeps jsonb_each off a non-object: SQL does not promise to
  -- short-circuit AND, and jsonb_each raises on an array.
  SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END) AS e(key, value)
     WHERE e.key !~ '^[a-z][A-Za-z]{0,63}$'
        OR NOT CASE jsonb_typeof(e.value)
             WHEN 'string' THEN e.value #>> '{}' ~ '^[A-Z][A-Z0-9_]{0,63}$'
                            AND e.value #>> '{}' !~ '[0-9]{3}'
             WHEN 'array' THEN jsonb_array_length(e.value) <= 64 AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(e.value) AS a(v)
                WHERE jsonb_typeof(a.v) <> 'string' OR a.v #>> '{}' !~ '^[a-z][A-Za-z]{0,63}$')
             ELSE false
           END)
$$;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" "AuditActorType" NOT NULL DEFAULT 'USER',
ADD COLUMN "params" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "audit_logs" ALTER COLUMN "description" DROP NOT NULL;

-- AlterTable
ALTER TABLE "platform_audit_logs" ADD COLUMN "actor_type" "AuditActorType" NOT NULL DEFAULT 'OPERATOR',
ADD COLUMN "params" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "platform_audit_logs" ALTER COLUMN "description" DROP NOT NULL;

-- Checks
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_params_are_codes CHECK (public.audit_params_are_codes(params));
ALTER TABLE public.platform_audit_logs
  ADD CONSTRAINT platform_audit_logs_params_are_codes CHECK (public.audit_params_are_codes(params));

-- A user's row names its user; a system row names none, so an empty user_id
-- never means "unknown". No row has a null user_id today (checked on
-- production, staging and development, 2026-10-11).
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_matches_user
  CHECK (actor_type <> 'OPERATOR' AND (actor_type = 'USER') = (user_id IS NOT NULL));

-- Only the operator writes here, for now. A system action on the platform
-- would make operator_id nullable and widen this, in its own migration.
ALTER TABLE public.platform_audit_logs
  ADD CONSTRAINT platform_audit_logs_actor_is_operator CHECK (actor_type = 'OPERATOR');
