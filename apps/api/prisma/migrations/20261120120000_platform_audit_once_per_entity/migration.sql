-- One platform row per object for the action that made it: a reset link is
-- generated once, a test alert sent once. Every other action on an object
-- may repeat.
--
-- The index of 20261012010200_platform_audit_entity was unique on
-- (action, entity, entity_id) for every row with an entity. A later action
-- that can happen twice on the same object (an alert resent, an operator
-- deactivated, reactivated and deactivated again) would fail its second row
-- with a unique violation, answering 500 and rolling the action back. It also
-- let one link carry two creation rows, one per creating action
-- (INVITATION_LINK_CREATED and PASSWORD_RESET_LINK_CREATED on the same token).
-- Now the key is the object, and only creating actions are in it: the
-- platform actions of the catalog (packages/shared/src/auditActions.ts) with
-- an entity and kind 'create'. tests/auditRowChecks.test.ts compares this list
-- with the catalog, so a new creating action fails until it is added here.
--
-- Existing rows: every link and every alert is created with a new id and
-- recorded once, so none can break the index. If one did, CREATE fails, the
-- migration rolls back whole and the deploy stops with the old index in place.
--
-- The predicate names PlatformAction values, so:
-- - a new creating action needs its ADD VALUE committed in an earlier
--   migration than the one that adds it here ("unsafe use of new value");
-- - rebuilding the PlatformAction type (new type + ALTER COLUMN ... TYPE, as
--   20261117120000_drop_dead_audit_codes did) has to drop this index first.
--
-- The migration scan (tests/auditMigrationScan.test.ts) does not look at
-- indexes, so it has nothing to allow here. audit-guards.sql pins this index
-- by name and exact definition, in CI and at every deploy.

LOCK TABLE public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;

DROP INDEX public.platform_audit_logs_action_entity_key;

CREATE UNIQUE INDEX platform_audit_logs_created_entity_key
  ON public.platform_audit_logs (entity, entity_id)
  WHERE action IN ('PASSWORD_RESET_LINK_CREATED', 'INVITATION_LINK_CREATED', 'TEST_ALERT_SENT');
