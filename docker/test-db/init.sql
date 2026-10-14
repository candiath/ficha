-- Runs once, when the container starts with an empty data directory.
--
-- The audit maintenance flag (docs/infra.md#audit-tables): the tests' cleanup
-- deletes audit rows, which the triggers allow only where this table exists.
-- Like the development and ci branches, this database is for tests only.
CREATE SCHEMA IF NOT EXISTS ficha_ops;
CREATE TABLE IF NOT EXISTS ficha_ops.audit_maintenance_allowed ();
