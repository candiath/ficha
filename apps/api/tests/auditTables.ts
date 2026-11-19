// The audit tables (#186, docs/specs/SPEC-audit-hardening.md), and the
// functions and enums their guarantees rest on: one list for every test that
// names them. tests/auditTablesCoverage.test.ts checks it against the database
// and against prisma/audit-guards.sql, so a new audit table, or a new trigger
// function on one, that is missing from a list fails there instead of going
// unchecked.

// Append-only, with created_at stamped by the database on insert.
export const STAMPED_AUDIT_TABLES = [
  'audit_logs',
  'platform_audit_logs',
  'sysadmin_alerts',
  'sysadmin_alert_deliveries',
] as const;

// Append-only, with no created_at: a revision is dated by its audit row
// (docs/specs/SPEC-clinical-revisions.md).
export const REVISION_TABLES = [
  'encounter_revisions',
  'patient_revisions',
  'episode_revisions',
  'evaluation_revisions',
  'consent_revisions',
  'patient_antecedent_revisions',
] as const;

export const AUDIT_TABLES: readonly string[] = [...STAMPED_AUDIT_TABLES, ...REVISION_TABLES];

// Names the tables had in migrations written before a rename, which the
// migration scan still reads.
export const FORMER_AUDIT_TABLE_NAMES = ['session_revisions', 'patient_event_revisions'] as const;

// The functions audit-guards.sql pins by hash: the triggers of the audit
// tables, the params check and the maintenance switch.
export const AUDIT_FUNCTIONS = [
  'audit_maintenance_on',
  'audit_rows_are_append_only',
  'audit_rows_stamp_created_at',
  'audit_rows_stamp_transaction_id',
  'audit_logs_check_session',
  'platform_audit_logs_check_session',
  'audit_params_are_codes',
] as const;

// The enum types of the audit tables' columns: renaming or dropping a value
// rewrites what stored rows say.
export const AUDIT_ENUMS = [
  'AuditAction',
  'AuditEntity',
  'AuditActorType',
  'PlatformAction',
  'PlatformAuditEntity',
  'SysadminAlertKind',
  'SysadminAlertOutcome',
] as const;

// A table named like an audit table: one created without any trigger would
// otherwise be in no list at all. Only the names that are append-only by rule
// (an audit log, a clinical revisions table); record_access_logs is left to
// its own spec (docs/specs/audit-map.md, record-access-log).
export const AUDIT_TABLE_NAME = /(^|_)audit_logs$|_revisions$/;

// Every table of the public schema with a trigger is an audit table, and every
// function of the public schema (outside extensions) is an audit function,
// unless listed here with the reason. Both empty today: a new trigger or
// function is audit machinery until someone says otherwise.
export const NON_AUDIT_TRIGGER_TABLES: Readonly<Record<string, string>> = {};
export const NON_AUDIT_FUNCTIONS: Readonly<Record<string, string>> = {};
