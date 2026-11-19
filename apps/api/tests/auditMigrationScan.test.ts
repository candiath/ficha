import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ENUMS, AUDIT_FUNCTIONS, AUDIT_TABLES, FORMER_AUDIT_TABLE_NAMES } from './auditTables';

// Row triggers do not see DDL. A migration could rewrite audit content with a
// type change (Prisma turns one into DROP COLUMN + ADD COLUMN), or switch the
// triggers off, and no trigger would object. So every migration written after
// #186 hardened the audit tables is scanned for DDL that touches them, their
// functions or their enums (docs/specs/SPEC-audit-hardening.md §1).
//
// A migration that really needs one of these goes on ALLOWED with its reason
// and the exact violations it is allowed, in a reviewed PR (the spec's "ask
// first"). Exact, so a statement added to it later does not pass unseen.

const MIGRATIONS = path.join(__dirname, '..', 'prisma', 'migrations');

// Every migration that existed when the triggers landed. Written by hand, not
// "older than X": a branch started earlier, with an older timestamp, is still
// scanned.
const FROZEN = new Set([
  '20260323160548_init',
  '20260323165943_init',
  '20260323205246_add_payments_and_packages',
  '20260326122115_add_consent_audit_alerts',
  '20260327185705_add_muscular_chain',
  '20260327190511_add_patient_insurance',
  '20260327191054_extend_initial_evaluation',
  '20260327191504_add_treatment_cycle',
  '20260327192143_add_functional_scales',
  '20260601140154_add_evolution_fields',
  '20260603144016_add_pain_frequency',
  '20260603144304_add_occupation_to_evaluation',
  '20260605000000_add_clinical_episode',
  '20260609000000_drop_patient_id_unique_on_evaluations',
  '20260609114235_',
  '20260610000000_concurrent_episodes',
  '20260706131346_add_posture_families',
  '20260706140052_patient_soft_delete',
  '20260707125352_add_user_auth_fields',
  '20260708141504_add_login_events',
  '20260708142154_add_tenant_to_login_events',
  '20260708143521_add_password_changed_at',
  '20260831155839_normalize_posture_families',
  '20260901215753_drop_tablas_tecnicas',
  '20260904133402_session_soft_delete',
  '20260904184752_tenant_config',
  '20260905043151_appointments',
  '20260905180924_alerts_refreshed_at',
  '20260914203652_platform_operator',
  '20261002154935_ids_uuid_nativos',
  '20261004141931_auth_sessions',
  '20261005015133_auth_sessions_last_used_trusted',
  '20261005181841_platform_action_devices_disconnected',
  '20261006011530_password_reset_tokens',
  '20261006132637_platform_action_password_reset',
  '20261009184545_audit_auth_session_id',
  '20261010130002_drop_users_password_changed_at',
  '20261010191055_audit_rows_enforced',
]);

const ALLOWED: Record<string, { reason: string; violations: string[] }> = {
  '20261121120000_audit_transaction_id': {
    reason:
      'Every audit row names the transaction that wrote it, stamped by the database like created_at. ' +
      'The column is added with a random default, so each existing row gets an id of its own, and then ' +
      'its default becomes the nil UUID, which a CHECK refuses: a missing trigger fails the insert instead ' +
      'of writing rows with no transaction. The new BEFORE INSERT triggers only stamp the new column; ' +
      'audit-guards.sql pins them, their function, the CHECKs and the NOT NULLs.',
    violations: [
      'ALTER COLUMN: ALTER TABLE "audit_logs" ALTER COLUMN "transaction_id" SET DEFAULT \'00000000-0000-0000-0000-000000000000\'::uuid',
      'ALTER COLUMN: ALTER TABLE "platform_audit_logs" ALTER COLUMN "transaction_id" SET DEFAULT \'00000000-0000-0000-0000-000000000000\'::uuid',
      'CREATE TRIGGER: CREATE TRIGGER audit_logs_stamp_transaction_id BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.a',
      'CREATE TRIGGER: CREATE TRIGGER platform_audit_logs_stamp_transaction_id BEFORE INSERT ON public.platform_audit_logs FOR EACH ROW EXECUTE',
    ],
  },
  '20261120120000_platform_audit_once_per_entity': {
    reason:
      'The platform unique index becomes one creation row per object (#338): the old one, on ' +
      '(action, entity, entity_id) for every row with an entity, would have failed the second row of any ' +
      'repeatable action on an object. It is dropped and its replacement created under the same lock, in ' +
      'the migration\'s one transaction, so no row is ever written without the guarantee; audit-guards.sql ' +
      'pins the new index. (The migration\'s comment says the scan does not look at indexes: true when it ' +
      'was written, before #337 taught it to.)',
    violations: ['DROP INDEX: DROP INDEX public.platform_audit_logs_action_entity_key'],
  },
  '20261119120000_operator_session_revocation_and_audit': {
    reason:
      'Platform audit rows record the operator session they came from (SPEC-audit-hardening.md, decision 2). ' +
      'A new BEFORE INSERT trigger checks it is a session of the row\'s operator, as audit_logs_check_session ' +
      'does for clinic users; it only refuses rows, never changes one, and audit-guards.sql pins it and its ' +
      'function.',
    violations: [
      'CREATE TRIGGER: CREATE TRIGGER platform_audit_logs_check_session BEFORE INSERT ON public.platform_audit_logs FOR EACH ROW EXECUTE FUNCTI',
    ],
  },
  '20261118130000_rename_patient_event_to_antecedent': {
    reason:
      'PatientEvent becomes PatientAntecedent ("Antecedentes" in the record) before the relaunch, while no ' +
      'deployed database holds clinical rows (#238). Only names change, as in the Encounter rename above: ' +
      'the revisions table, its column, indexes, constraints and triggers keep their definitions (audit-guards.sql ' +
      'pins the new names), and the audit codes PATIENT_EVENT* are renamed in place.',
    violations: [
      "RENAME: ALTER TYPE \"AuditEntity\" RENAME VALUE 'PATIENT_EVENT' TO 'PATIENT_ANTECEDENT'",
      "RENAME: ALTER TYPE \"AuditAction\" RENAME VALUE 'PATIENT_EVENT_RECORDED' TO 'PATIENT_ANTECEDENT_RECORDED'",
      "RENAME: ALTER TYPE \"AuditAction\" RENAME VALUE 'PATIENT_EVENT_UPDATED' TO 'PATIENT_ANTECEDENT_UPDATED'",
      "RENAME: ALTER TYPE \"AuditAction\" RENAME VALUE 'PATIENT_EVENT_ANNULLED' TO 'PATIENT_ANTECEDENT_ANNULLED'",
      "RENAME: ALTER TABLE \"patient_event_revisions\" RENAME TO \"patient_antecedent_revisions\"",
      "RENAME: ALTER TABLE \"patient_antecedent_revisions\" RENAME COLUMN \"patient_event_id\" TO \"patient_antecedent_id\"",
      "RENAME: ALTER INDEX \"patient_event_revisions_pkey\" RENAME TO \"patient_antecedent_revisions_pkey\"",
      "RENAME: ALTER INDEX \"patient_event_revisions_audit_log_id_idx\" RENAME TO \"patient_antecedent_revisions_audit_log_id_idx\"",
      "RENAME: ALTER INDEX \"patient_event_revisions_patient_event_id_version_key\" RENAME TO \"patient_antecedent_revisions_patient_antec",
      "RENAME: ALTER INDEX \"patient_event_revisions_tenant_id_idx\" RENAME TO \"patient_antecedent_revisions_tenant_id_idx\"",
      "RENAME: ALTER TABLE \"patient_antecedent_revisions\" RENAME CONSTRAINT \"patient_event_revisions_tenant_id_fkey\" TO \"patient_antece",
      "RENAME: ALTER TABLE \"patient_antecedent_revisions\" RENAME CONSTRAINT \"patient_event_revisions_tenant_id_patient_id_audit_log_id_",
      "RENAME: ALTER TABLE \"patient_antecedent_revisions\" RENAME CONSTRAINT \"patient_event_revisions_tenant_id_patient_id_patient_event",
      "RENAME: ALTER TABLE \"patient_antecedent_revisions\" RENAME CONSTRAINT \"patient_event_revisions_version_positive\" TO \"patient_ante",
      "RENAME: ALTER TRIGGER \"patient_event_revisions_append_only\" ON \"patient_antecedent_revisions\" RENAME TO \"patient_antecedent_revi",
      "RENAME: ALTER TRIGGER \"patient_event_revisions_no_truncate\" ON \"patient_antecedent_revisions\" RENAME TO \"patient_antecedent_revi",
    ],
  },
  '20261118120000_rename_session_to_encounter': {
    reason:
      'The clinical Session becomes Encounter before the relaunch, while no deployed database holds ' +
      'clinical rows (#238). Only names change: the revisions table, its column, indexes, constraints and ' +
      'triggers keep their definitions (audit-guards.sql pins the new names), and the audit codes ' +
      'SESSION, SESSION_RECORDED, SESSION_UPDATED and SESSION_ANNULLED are renamed in place, so a row ' +
      'that held one reads the new code.',
    violations: [
      "RENAME: ALTER TYPE \"AuditEntity\" RENAME VALUE 'SESSION' TO 'ENCOUNTER'",
      "RENAME: ALTER TYPE \"AuditAction\" RENAME VALUE 'SESSION_RECORDED' TO 'ENCOUNTER_RECORDED'",
      "RENAME: ALTER TYPE \"AuditAction\" RENAME VALUE 'SESSION_UPDATED' TO 'ENCOUNTER_UPDATED'",
      "RENAME: ALTER TYPE \"AuditAction\" RENAME VALUE 'SESSION_ANNULLED' TO 'ENCOUNTER_ANNULLED'",
      "RENAME: ALTER TABLE \"session_revisions\" RENAME TO \"encounter_revisions\"",
      "RENAME: ALTER TABLE \"encounter_revisions\" RENAME COLUMN \"session_id\" TO \"encounter_id\"",
      "RENAME: ALTER INDEX \"session_revisions_pkey\" RENAME TO \"encounter_revisions_pkey\"",
      "RENAME: ALTER INDEX \"session_revisions_audit_log_id_idx\" RENAME TO \"encounter_revisions_audit_log_id_idx\"",
      "RENAME: ALTER INDEX \"session_revisions_session_id_version_key\" RENAME TO \"encounter_revisions_encounter_id_version_key\"",
      "RENAME: ALTER INDEX \"session_revisions_tenant_id_idx\" RENAME TO \"encounter_revisions_tenant_id_idx\"",
      "RENAME: ALTER TABLE \"encounter_revisions\" RENAME CONSTRAINT \"session_revisions_tenant_id_fkey\" TO \"encounter_revisions_tenant_id",
      "RENAME: ALTER TABLE \"encounter_revisions\" RENAME CONSTRAINT \"session_revisions_tenant_id_patient_id_audit_log_id_fkey\" TO \"encou",
      "RENAME: ALTER TABLE \"encounter_revisions\" RENAME CONSTRAINT \"session_revisions_tenant_id_patient_id_session_id_fkey\" TO \"encount",
      "RENAME: ALTER TABLE \"encounter_revisions\" RENAME CONSTRAINT \"session_revisions_version_positive\" TO \"encounter_revisions_version",
      "RENAME: ALTER TRIGGER \"session_revisions_append_only\" ON \"encounter_revisions\" RENAME TO \"encounter_revisions_append_only\"",
      "RENAME: ALTER TRIGGER \"session_revisions_no_truncate\" ON \"encounter_revisions\" RENAME TO \"encounter_revisions_no_truncate\"",
    ],
  },
  '20261117120000_drop_dead_audit_codes': {
    reason:
      'Before the relaunch, with no row holding them, the dead audit codes leave the enums (AuditAction, ' +
      'AuditEntity, PlatformAction). Postgres cannot drop an enum value, so each type is recreated: a new ' +
      'type, the column switched through text, the old type dropped (after the switch, so no CASCADE) and the new one renamed. A DO block ' +
      'before each switch fails the migration if a row still holds a removed value. A type change rewrites ' +
      'the table without firing the row triggers, and audit-guards.sql passes unchanged.',
    violations: [
      'ALTER COLUMN: ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "AuditAction_new" USING "action"::text::"AuditAction_new"',
      'DROP TYPE: DROP TYPE "AuditAction"',
      'RENAME: ALTER TYPE "AuditAction_new" RENAME TO "AuditAction"',
      'ALTER COLUMN: ALTER TABLE "audit_logs" ALTER COLUMN "entity" TYPE "AuditEntity_new" USING "entity"::text::"AuditEntity_new"',
      'DROP TYPE: DROP TYPE "AuditEntity"',
      'RENAME: ALTER TYPE "AuditEntity_new" RENAME TO "AuditEntity"',
      'ALTER COLUMN: ALTER TABLE "platform_audit_logs" ALTER COLUMN "action" TYPE "PlatformAction_new" USING "action"::text::"PlatformAction_',
      'DROP TYPE: DROP TYPE "PlatformAction"',
      'RENAME: ALTER TYPE "PlatformAction_new" RENAME TO "PlatformAction"',
    ],
  },
  '20261116120000_timestamptz': {
    reason:
      'Every timestamp column becomes timestamptz(3) before the relaunch (#238), with no real rows yet. ' +
      'The four audit created_at columns are converted with AT TIME ZONE \'UTC\', so the stored instants ' +
      'do not change, and the stamp function writes clock_timestamp() itself, the instant, into them ' +
      '(new hash in audit-guards.sql).',
    violations: [
      'ALTER COLUMN: ALTER TABLE "platform_audit_logs" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE',
      'ALTER COLUMN: ALTER TABLE "sysadmin_alerts" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE \'UT',
      'ALTER COLUMN: ALTER TABLE "sysadmin_alert_deliveries" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIM',
      'ALTER COLUMN: ALTER TABLE "audit_logs" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE \'UTC\'',
      'CREATE OR REPLACE FUNCTION: CREATE OR REPLACE FUNCTION public.audit_rows_stamp_created_at() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_ca',
    ],
  },
  '20261107120000_clinical_revisions_aggregates': {
    reason:
      'The tables of the other five clinical aggregates (SPEC-clinical-revisions.md §6) are born ' +
      'with the append-only triggers of the audit tables, calling their existing function.',
    violations: [
      'CREATE TRIGGER: CREATE TRIGGER patient_revisions_append_only BEFORE UPDATE OR DELETE ON public.patient_revisions FOR EACH ROW EXECUTE FU',
      'CREATE TRIGGER: CREATE TRIGGER patient_revisions_no_truncate BEFORE TRUNCATE ON public.patient_revisions FOR EACH STATEMENT EXECUTE FUNC',
      'CREATE TRIGGER: CREATE TRIGGER episode_revisions_append_only BEFORE UPDATE OR DELETE ON public.episode_revisions FOR EACH ROW EXECUTE FU',
      'CREATE TRIGGER: CREATE TRIGGER episode_revisions_no_truncate BEFORE TRUNCATE ON public.episode_revisions FOR EACH STATEMENT EXECUTE FUNC',
      'CREATE TRIGGER: CREATE TRIGGER evaluation_revisions_append_only BEFORE UPDATE OR DELETE ON public.evaluation_revisions FOR EACH ROW EXEC',
      'CREATE TRIGGER: CREATE TRIGGER evaluation_revisions_no_truncate BEFORE TRUNCATE ON public.evaluation_revisions FOR EACH STATEMENT EXECUT',
      'CREATE TRIGGER: CREATE TRIGGER consent_revisions_append_only BEFORE UPDATE OR DELETE ON public.consent_revisions FOR EACH ROW EXECUTE FU',
      'CREATE TRIGGER: CREATE TRIGGER consent_revisions_no_truncate BEFORE TRUNCATE ON public.consent_revisions FOR EACH STATEMENT EXECUTE FUNC',
      'CREATE TRIGGER: CREATE TRIGGER patient_event_revisions_append_only BEFORE UPDATE OR DELETE ON public.patient_event_revisions FOR EACH RO',
      'CREATE TRIGGER: CREATE TRIGGER patient_event_revisions_no_truncate BEFORE TRUNCATE ON public.patient_event_revisions FOR EACH STATEMENT ',
    ],
  },
  '20261106180000_session_revisions': {
    reason:
      'The table of session versions (SPEC-clinical-revisions.md §6) is born with the append-only ' +
      'triggers of the audit tables, calling their existing function.',
    violations: [
      'CREATE TRIGGER: CREATE TRIGGER session_revisions_append_only BEFORE UPDATE OR DELETE ON public.session_revisions FOR EACH ROW EXECUTE FU',
      'CREATE TRIGGER: CREATE TRIGGER session_revisions_no_truncate BEFORE TRUNCATE ON public.session_revisions FOR EACH STATEMENT EXECUTE FUNC',
    ],
  },
  '20261012030000_drop_audit_description': {
    reason:
      'Release 2 of audit rows as codes (SPEC-audit-structured-entries.md): the Spanish description ' +
      'is dropped from both audit tables, once, before the pre-launch wipe (#223): every row that ' +
      'has one holds fictitious data. No code since release 1 writes or reads it.',
    violations: [
      'DROP COLUMN: ALTER TABLE "audit_logs" DROP COLUMN "description"',
      'DROP COLUMN: ALTER TABLE "platform_audit_logs" DROP COLUMN "description"',
    ],
  },
  '20261012010100_audit_params_and_actor': {
    reason:
      'Audit rows as codes (SPEC-audit-structured-entries.md): description stops being required on ' +
      'both audit tables, because the code no longer writes it. Release 2 drops it.',
    violations: [
      'ALTER COLUMN: ALTER TABLE "audit_logs" ALTER COLUMN "description" DROP NOT NULL',
      'ALTER COLUMN: ALTER TABLE "platform_audit_logs" ALTER COLUMN "description" DROP NOT NULL',
    ],
  },
  '20261011193500_sysadmin_alerts': {
    reason:
      'The sysadmin alert tables (SPEC-sysadmin-alerts.md): six triggers that call the audit ' +
      'functions on the two new tables, and platform_audit_logs.tenant_id made nullable for an ' +
      'action on the platform itself (two CHECKs keep it narrow, pinned by audit-guards.sql).',
    violations: [
      'ALTER COLUMN: ALTER TABLE "platform_audit_logs" ALTER COLUMN "tenant_id" DROP NOT NULL',
      'CREATE TRIGGER: CREATE TRIGGER sysadmin_alerts_stamp_created_at BEFORE INSERT ON public.sysadmin_alerts FOR EACH ROW EXECUTE FUNCTION pu',
      'CREATE TRIGGER: CREATE TRIGGER sysadmin_alerts_append_only BEFORE UPDATE OR DELETE ON public.sysadmin_alerts FOR EACH ROW EXECUTE FUNCTI',
      'CREATE TRIGGER: CREATE TRIGGER sysadmin_alerts_no_truncate BEFORE TRUNCATE ON public.sysadmin_alerts FOR EACH STATEMENT EXECUTE FUNCTION',
      'CREATE TRIGGER: CREATE TRIGGER sysadmin_alert_deliveries_stamp_created_at BEFORE INSERT ON public.sysadmin_alert_deliveries FOR EACH ROW',
      'CREATE TRIGGER: CREATE TRIGGER sysadmin_alert_deliveries_append_only BEFORE UPDATE OR DELETE ON public.sysadmin_alert_deliveries FOR EAC',
      'CREATE TRIGGER: CREATE TRIGGER sysadmin_alert_deliveries_no_truncate BEFORE TRUNCATE ON public.sysadmin_alert_deliveries FOR EACH STATEM',
    ],
  },
};

// From tests/auditTables.ts, which auditTablesCoverage.test.ts checks against
// the database: a new audit table, trigger function or enum cannot be left
// out of the scan.
// A table's name also matches as the start of a longer one: its indexes,
// constraints and triggers are named after it (audit_logs_tenant_id_patient_id_id_key),
// and `_` is a word character, so \b alone would not see them. An enum's too:
// Prisma recreates one as <name>_new and drops the old one as <name>_old.
const AUDIT_NAMES = new RegExp(
  `\\b(${[...AUDIT_TABLES, ...FORMER_AUDIT_TABLE_NAMES, ...AUDIT_ENUMS].join('|')})(_\\w+)?\\b` +
    `|\\b(${AUDIT_FUNCTIONS.join('|')})\\b`,
  'i',
);

const FORBIDDEN: [string, RegExp][] = [
  // COLUMN is optional in Postgres: `ALTER TABLE audit_logs DROP entity_id`
  // drops it too, and `ALTER "params" TYPE …` rewrites it. Any ALTER or DROP
  // inside an ALTER TABLE, except the column-property forms (DROP NOT NULL,
  // DROP DEFAULT…), which ALTER COLUMN already names, DROP CONSTRAINT, which
  // has its own entry, and ALTER CONSTRAINT, which no rule names:
  // audit-guards.sql pins every constraint of the audit tables, and a foreign
  // key made NOT ENFORCED (Postgres 18) is no longer convalidated.
  // One \s, and the rest inside the lookahead: a \s+ outside it would give
  // back a space and let `DROP  CONSTRAINT` through as a column.
  ['ALTER COLUMN', /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s(?!\s*CONSTRAINT\b)/i],
  ['DROP COLUMN', /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s(?!\s*(?:CONSTRAINT|NOT\s+NULL|DEFAULT|EXPRESSION|IDENTITY)\b)/i],
  ['RENAME', /\bRENAME\b/i],
  ['DROP TABLE', /\bDROP\s+TABLE\b/i],
  ['DROP CONSTRAINT', /\bDROP\s+CONSTRAINT\b/i],
  // A unique index can be a guarantee (audit-guards.sql pins the ones that
  // are); dropping it removes the guarantee. Any index of an audit table, on
  // purpose: a name does not say whether it is unique, so dropping a plain
  // @@index needs an entry too. Creating one is additive.
  ['DROP INDEX', /\bDROP\s+INDEX\b/i],
  ['SET UNLOGGED', /\bSET\s+UNLOGGED\b/i],
  ['OWNER TO', /\bOWNER\s+TO\b/i],
  ['CREATE TRIGGER', /\bCREATE\s+(OR\s+REPLACE\s+)?(CONSTRAINT\s+)?TRIGGER\b/i],
  ['DISABLE TRIGGER', /\bDISABLE\s+TRIGGER\b/i],
  // A REPLICA or ALWAYS trigger fires under a different session_replication_role.
  ['ENABLE REPLICA/ALWAYS TRIGGER', /\bENABLE\s+(REPLICA|ALWAYS)\s+TRIGGER\b/i],
  // A child table has none of the triggers or keys, and its rows show up in
  // reads of the parent.
  ['INHERITS', /\bINHERITS\b/i],
  ['ATTACH PARTITION', /\bATTACH\s+PARTITION\b/i],
  ['DROP TRIGGER', /\bDROP\s+TRIGGER\b/i],
  ['CREATE RULE', /\bCREATE\s+(OR\s+REPLACE\s+)?RULE\b/i],
  ['POLICY', /\bPOLICY\b/i],
  ['ROW LEVEL SECURITY', /\bROW\s+LEVEL\s+SECURITY\b/i],
  ['CREATE OR REPLACE FUNCTION', /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/i],
  ['ALTER FUNCTION', /\bALTER\s+FUNCTION\b/i],
  ['DROP FUNCTION', /\bDROP\s+FUNCTION\b/i],
  // Recreating an audit enum (new type, column switched, old type dropped)
  // done in the wrong order fails without CASCADE, and CASCADE drops the
  // column with every row's code.
  ['DROP TYPE', /\bDROP\s+TYPE\b/i],
];

// SQL built at run time (EXECUTE in a DO block or a function) names no table
// the scan can read: a loop over every table with created_at reaches the
// audit tables unseen. Flagged whatever it names; EXECUTE FUNCTION and
// EXECUTE PROCEDURE are a trigger's, and EXECUTE ON (GRANT, REVOKE) a
// privilege, not dynamic SQL.
const DYNAMIC_SQL = /\bEXECUTE\b(?!\s+(?:FUNCTION|PROCEDURE|ON)\b)/i;

// What a migration does to the audit tables that it may not: one entry per
// offending statement. Statements are split on ";", which is good enough to
// find them (a function body split in two still names what it touches). It
// guards against our own mistakes, not against a migration written to evade
// it. Dynamic SQL counts wherever it appears; the rest only in a statement
// that names an audit table, function or enum. A migration that names the
// maintenance flag fails noMaintenanceFlagMigration.test.ts, not this scan.
function auditDdlViolations(sql: string): string[] {
  // Comments are not statements: both forms go, as in noMaintenanceFlagMigration.test.ts.
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const violations: string[] = [];
  if (/session_replication_role/i.test(code)) violations.push('session_replication_role');
  for (const statement of code.split(';')) {
    const text = statement.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (DYNAMIC_SQL.test(statement)) violations.push(`DYNAMIC SQL: ${text}`);
    if (!AUDIT_NAMES.test(statement)) continue;
    for (const [name, pattern] of FORBIDDEN) {
      if (pattern.test(statement)) violations.push(`${name}: ${text}`);
    }
  }
  return violations;
}

describe('migrations leave the audit tables alone', () => {
  const migrations = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('the frozen list names migrations that exist', () => {
    for (const name of FROZEN) expect(migrations).toContain(name);
  });

  it('an allowed migration does exactly what it is allowed', () => {
    for (const [name, { reason, violations }] of Object.entries(ALLOWED)) {
      expect(migrations).toContain(name);
      expect(reason).not.toBe('');
      const sql = readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8');
      expect({ name, violations: auditDdlViolations(sql) }).toEqual({ name, violations });
    }
  });

  it('no later migration touches them, unless allowed', () => {
    const offending = migrations
      .filter((name) => !FROZEN.has(name) && !(name in ALLOWED))
      .map((name) => ({
        name,
        violations: auditDdlViolations(readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8')),
      }))
      .filter((m) => m.violations.length > 0);

    expect(offending).toEqual([]);
  });

  it('catches what it must, and lets additive changes through', () => {
    expect(auditDdlViolations('DROP TRIGGER audit_logs_append_only ON "audit_logs";')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE "audit_logs" ALTER COLUMN "description" SET DATA TYPE TEXT;')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE "audit_logs" DROP COLUMN "description";')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE platform_audit_logs DISABLE TRIGGER USER;')).toHaveLength(1);
    expect(auditDdlViolations('CREATE OR REPLACE FUNCTION public.audit_maintenance_on() RETURNS boolean')).toHaveLength(1);
    expect(auditDdlViolations('CREATE OR REPLACE FUNCTION public.audit_params_are_codes(p jsonb) RETURNS boolean')).toHaveLength(1);
    expect(auditDdlViolations(`ALTER TYPE "PlatformAuditEntity" RENAME VALUE 'SYSADMIN_ALERT' TO 'ALERT';`)).toHaveLength(1);
    expect(auditDdlViolations('ALTER TYPE "AuditAction" RENAME VALUE \'CREATED\' TO \'ADDED\';')).toHaveLength(1);
    expect(auditDdlViolations('SET session_replication_role = replica;')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_append_only;')).toHaveLength(1);
    expect(auditDdlViolations('CREATE TABLE forged (LIKE audit_logs) INHERITS (audit_logs);')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE audit_logs ATTACH PARTITION forged DEFAULT;')).toHaveLength(1);

    expect(auditDdlViolations('ALTER TABLE "audit_logs" ADD COLUMN "x" UUID;')).toEqual([]);
    expect(auditDdlViolations('ALTER TYPE "AuditAction" ADD VALUE \'VIEWED\';')).toEqual([]);
    expect(auditDdlViolations('ALTER TABLE "patients" DROP COLUMN "notes";')).toEqual([]);
    expect(auditDdlViolations('-- DROP TRIGGER audit_logs_append_only (a comment)')).toEqual([]);
    // Prisma's warnings, a block comment glued to the first statement, can name
    // an audit table that statement does not touch.
    const warned = `/*
  Warnings:

  - A unique constraint covering the columns \`[tenant_id,id]\` on the table \`audit_logs\` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "patients_tenant_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_tenant_id_id_key" ON "audit_logs"("tenant_id", "id");`;
    expect(auditDdlViolations(warned)).toEqual([]);

    // The alert tables are audit tables too.
    expect(auditDdlViolations('DROP TRIGGER sysadmin_alerts_append_only ON sysadmin_alerts;')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE "sysadmin_alert_deliveries" DROP COLUMN "detail";')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TYPE "SysadminAlertOutcome" RENAME VALUE \'SENT\' TO \'OK\';')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TYPE "SysadminAlertKind" ADD VALUE \'ACCESS_BURST\';')).toEqual([]);

    // Indexes, named after their table: dropping or renaming one is seen,
    // creating one is additive.
    expect(auditDdlViolations('DROP INDEX public.platform_audit_logs_action_entity_key;')).toHaveLength(1);
    expect(auditDdlViolations('DROP INDEX "audit_logs_tenant_id_patient_id_id_key";')).toHaveLength(1);
    expect(
      auditDdlViolations('ALTER INDEX "encounter_revisions_encounter_id_version_key" RENAME TO "x_key";'),
    ).toHaveLength(1);
    expect(auditDdlViolations('CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");')).toEqual([]);
    expect(auditDdlViolations('DROP INDEX "patients_tenant_id_idx";')).toEqual([]);
    expect(auditDdlViolations('DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_created_at_idx";')).toHaveLength(1);
    // A column named after a table in the singular is not the table.
    expect(auditDdlViolations('ALTER TABLE "x" DROP COLUMN "audit_log_id";')).toEqual([]);
  });

  // Mistakes a migration written by hand can make (#337's review).
  it('catches a column dropped or retyped without the word COLUMN', () => {
    expect(auditDdlViolations('ALTER TABLE "audit_logs" DROP "entity_id";')).toEqual([
      'DROP COLUMN: ALTER TABLE "audit_logs" DROP "entity_id"',
    ]);
    expect(auditDdlViolations('ALTER TABLE ONLY audit_logs DROP IF EXISTS entity_id;')).toHaveLength(1);
    expect(auditDdlViolations(`ALTER TABLE "audit_logs" ALTER "params" TYPE jsonb USING '{}'::jsonb;`)).toEqual([
      `ALTER COLUMN: ALTER TABLE "audit_logs" ALTER "params" TYPE jsonb USING '{}'::jsonb`,
    ]);
    // The column-property and constraint forms are what they were: one entry each.
    expect(auditDdlViolations('ALTER TABLE "audit_logs" ALTER COLUMN "description" DROP NOT NULL;')).toEqual([
      'ALTER COLUMN: ALTER TABLE "audit_logs" ALTER COLUMN "description" DROP NOT NULL',
    ]);
    expect(auditDdlViolations('ALTER TABLE "audit_logs" DROP CONSTRAINT "x";')).toEqual([
      'DROP CONSTRAINT: ALTER TABLE "audit_logs" DROP CONSTRAINT "x"',
    ]);
    for (const property of ['DROP DEFAULT', 'DROP EXPRESSION', 'DROP IDENTITY IF EXISTS', 'DROP  NOT\n  NULL']) {
      const sql = `ALTER TABLE "audit_logs" ALTER COLUMN "x" ${property};`;
      expect(auditDdlViolations(sql), sql).toEqual([`ALTER COLUMN: ${sql.slice(0, -1).replace(/\s+/g, ' ')}`]);
    }
    // However the keywords are spaced.
    expect(auditDdlViolations('ALTER TABLE "audit_logs"\n  DROP\n  CONSTRAINT "x";')).toEqual([
      'DROP CONSTRAINT: ALTER TABLE "audit_logs" DROP CONSTRAINT "x"',
    ]);
    expect(auditDdlViolations('ALTER TABLE "audit_logs" ADD COLUMN "x" UUID;')).toEqual([]);
    expect(auditDdlViolations('ALTER TABLE "audit_logs" ADD COLUMN "drop" TEXT, ADD COLUMN "alter" TEXT;')).toEqual([]);
  });

  it('catches an audit enum dropped', () => {
    expect(auditDdlViolations('DROP TYPE "AuditAction" CASCADE;')).toEqual(['DROP TYPE: DROP TYPE "AuditAction" CASCADE']);
    expect(auditDdlViolations('DROP TYPE "ScaleType";')).toEqual([]);
    // Prisma recreates an enum under a temporary name: the old type is renamed
    // to <name>_old and dropped under that name.
    expect(auditDdlViolations('DROP TYPE "AuditAction_old" CASCADE;')).toEqual([
      'DROP TYPE: DROP TYPE "AuditAction_old" CASCADE',
    ]);
    expect(auditDdlViolations('DROP TYPE "PlatformAuditEntity_old";')).toHaveLength(1);
  });

  it('catches dynamic SQL, whatever it names', () => {
    const loop = `DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT table_name FROM information_schema.columns WHERE column_name = 'created_at' LOOP
        EXECUTE format('ALTER TABLE %I ALTER created_at TYPE timestamptz', r.table_name);
      END LOOP; END $$;`;
    expect(auditDdlViolations(loop)).toHaveLength(1);
    expect(auditDdlViolations(loop)[0]).toMatch(/^DYNAMIC SQL: /);
    // A trigger's EXECUTE FUNCTION or PROCEDURE is not dynamic SQL, nor is the
    // EXECUTE privilege.
    expect(
      auditDdlViolations('CREATE TRIGGER t BEFORE INSERT ON "patients" FOR EACH ROW EXECUTE FUNCTION public.f();'),
    ).toEqual([]);
    expect(auditDdlViolations('CREATE TRIGGER t AFTER UPDATE ON "patients" FOR EACH ROW EXECUTE PROCEDURE f();')).toEqual(
      [],
    );
    expect(auditDdlViolations('REVOKE EXECUTE ON FUNCTION public.audit_maintenance_on() FROM PUBLIC;')).toEqual([]);
    expect(auditDdlViolations('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO app;')).toEqual([]);
  });
});
