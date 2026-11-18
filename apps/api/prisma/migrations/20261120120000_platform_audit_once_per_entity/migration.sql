-- One platform row per action on an object, only for the objects that are made
-- by their action: a reset link is generated once, a test alert sent once.
--
-- The index of 20261012010200_platform_audit_entity covered every entity. An
-- object that exists before the action and can receive it again (an operator
-- deactivated, reactivated and deactivated again) would fail its second row
-- with a unique violation, answering 500 and rolling the action back. Listing
-- the entities instead leaves a new one out of the index until someone decides
-- otherwise; tests/auditRowChecks.test.ts makes that decision explicit for
-- each value of PlatformAuditEntity.
--
-- The new index allows every row the old one did, so no existing row can
-- break it. Same name, so audit-guards.sql keeps pinning it by its definition.
-- No entry in tests/auditMigrationScan.test.ts: dropping and creating an index
-- cannot rewrite or unprotect audit content.

LOCK TABLE public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;

DROP INDEX public.platform_audit_logs_action_entity_key;

CREATE UNIQUE INDEX platform_audit_logs_action_entity_key
  ON public.platform_audit_logs (action, entity, entity_id)
  WHERE entity IN ('PASSWORD_RESET_TOKEN', 'SYSADMIN_ALERT');
