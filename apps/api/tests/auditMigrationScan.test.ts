import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Row triggers do not see DDL. A migration could rewrite audit content with a
// type change (Prisma turns one into DROP COLUMN + ADD COLUMN), or switch the
// triggers off, and no trigger would object. So every migration written after
// #186 hardened the audit tables is scanned for DDL that touches them, their
// functions or their enums (docs/specs/SPEC-audit-hardening.md §1).
//
// A migration that really needs one of these goes on ALLOWED with its reason,
// in a reviewed PR (the spec's "ask first").

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

const ALLOWED: Record<string, string> = {};

const AUDIT_NAMES =
  /\b(audit_logs|platform_audit_logs|audit_maintenance_on|audit_rows_are_append_only|audit_rows_stamp_created_at|audit_logs_check_session|AuditAction|AuditEntity|PlatformAction)\b/i;

const FORBIDDEN: [string, RegExp][] = [
  ['ALTER COLUMN', /\bALTER\s+COLUMN\b/i],
  ['DROP COLUMN', /\bDROP\s+COLUMN\b/i],
  ['RENAME', /\bRENAME\b/i],
  ['DROP TABLE', /\bDROP\s+TABLE\b/i],
  ['DROP CONSTRAINT', /\bDROP\s+CONSTRAINT\b/i],
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
];

// What a migration does to the audit tables that it may not: one entry per
// offending statement. Statements are split on ";", which is good enough to
// find them (a function body split in two still names what it touches).
function auditDdlViolations(sql: string): string[] {
  const code = sql.replace(/--[^\n]*/g, '');
  const violations: string[] = [];
  if (/session_replication_role/i.test(code)) violations.push('session_replication_role');
  for (const statement of code.split(';')) {
    if (!AUDIT_NAMES.test(statement)) continue;
    for (const [name, pattern] of FORBIDDEN) {
      if (pattern.test(statement)) violations.push(`${name}: ${statement.trim().slice(0, 120)}`);
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
    expect(auditDdlViolations('ALTER TYPE "AuditAction" RENAME VALUE \'CREATED\' TO \'ADDED\';')).toHaveLength(1);
    expect(auditDdlViolations('SET session_replication_role = replica;')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_append_only;')).toHaveLength(1);
    expect(auditDdlViolations('CREATE TABLE forged (LIKE audit_logs) INHERITS (audit_logs);')).toHaveLength(1);
    expect(auditDdlViolations('ALTER TABLE audit_logs ATTACH PARTITION forged DEFAULT;')).toHaveLength(1);

    expect(auditDdlViolations('ALTER TABLE "audit_logs" ADD COLUMN "x" UUID;')).toEqual([]);
    expect(auditDdlViolations('ALTER TYPE "AuditAction" ADD VALUE \'VIEWED\';')).toEqual([]);
    expect(auditDdlViolations('ALTER TABLE "patients" DROP COLUMN "notes";')).toEqual([]);
    expect(auditDdlViolations('-- DROP TRIGGER audit_logs_append_only (a comment)')).toEqual([]);
  });
});
