-- Fails (raises) when this database carries the audit maintenance flag (#186,
-- docs/specs/SPEC-audit-hardening.md §1). Only development and ci may have
-- it; on staging and production it would let audit rows be deleted or
-- backdated. Runs before `migrate deploy` on Render, and at API startup when
-- NODE_ENV=production:
--   prisma db execute --file prisma/no-audit-maintenance.sql --schema prisma/schema.prisma
DO $guards$
BEGIN
  IF to_regclass('ficha_ops.audit_maintenance_allowed') IS NOT NULL THEN
    RAISE EXCEPTION 'audit guards failed: this database carries the audit maintenance flag '
      '(ficha_ops.audit_maintenance_allowed), which only development and ci may have';
  END IF;
END
$guards$;
