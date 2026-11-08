import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A migration that rewrites a versioned table changes clinical content with no
// version and no audit row, and neither the triggers nor the invariant see it
// (SPEC-clinical-revisions.md §9). So every migration written after revisions
// landed is scanned. One that really needs it goes on ALLOWED with its reason,
// in a reviewed PR; after the relaunch it also writes SYSTEM audit rows and
// revisions (HISTORY_MIGRATED).

const MIGRATIONS = path.join(__dirname, '..', 'prisma', 'migrations');

const VERSIONED_TABLES = [
  'sessions',
  'session_episodes',
  'patients',
  'clinical_episodes',
  'initial_evaluations',
  'informed_consents',
  'patient_events',
];

// Every migration that existed before this scan. Written by hand, not "older
// than X": a branch started earlier, with an older timestamp, is still scanned.
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
  '20261011193500_sysadmin_alerts',
  '20261012010000_audit_action_codes',
  '20261012010100_audit_params_and_actor',
  '20261012010200_platform_audit_entity',
  '20261012030000_drop_audit_description',
  '20261012040000_session_patient_exercises',
  '20261013220000_session_episode_blocks',
  '20261014120000_visit_notes_per_motive',
  '20261014140000_initial_evaluation_without_rpg',
  '20261014160000_patient_events',
  '20261015120000_drop_foot_evaluation',
  '20261024120000_model_integrity',
  '20261024140000_money_in_cents',
  '20261024160000_payment_paid_invariant',
  '20261024180000_scale_band_from_score',
  '20261024200000_consent_signed_from_dates',
  '20261024220000_patient_name_split',
  '20261027120000_remove_functional_scales',
  '20261028120000_drop_flexibility_notes',
  '20261101120000_clinical_revisions_prereqs',
  '20261106120000_audit_appointments_and_packages',
]);

const ALLOWED: Record<string, { reason: string; violations: string[] }> = {};

export function historyViolations(sql: string): string[] {
  const code = sql.replace(/--[^\n]*/g, '');
  const violations: string[] = [];
  for (const statement of code.split(';')) {
    const text = statement.trim().replace(/\s+/g, ' ');
    for (const table of VERSIONED_TABLES) {
      const name = String.raw`(?:public\.)?"?${table}"?(?![\w"])`;
      const forbidden: [string, RegExp][] = [
        ['UPDATE', new RegExp(String.raw`\bUPDATE (?:ONLY )?${name}`, 'i')],
        ['DELETE', new RegExp(String.raw`\bDELETE FROM (?:ONLY )?${name}`, 'i')],
        ['TRUNCATE', new RegExp(String.raw`\bTRUNCATE (?:TABLE )?(?:ONLY )?${name}`, 'i')],
        ['DROP COLUMN', new RegExp(String.raw`\bALTER TABLE (?:ONLY )?${name}.*\bDROP (?:COLUMN )?"?\w`, 'i')],
        ['ALTER COLUMN TYPE', new RegExp(String.raw`\bALTER TABLE (?:ONLY )?${name}.*\bALTER (?:COLUMN )?\S+ (?:SET DATA )?TYPE\b`, 'i')],
      ];
      for (const [kind, pattern] of forbidden) {
        if (pattern.test(text)) violations.push(`${kind}: ${text.slice(0, 120)}`);
      }
    }
  }
  return violations;
}

describe('migrations leave the versioned tables alone', () => {
  const migrations = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('finds nothing unlisted in the migrations since the scan started', () => {
    for (const name of migrations) {
      if (FROZEN.has(name)) continue;
      const sql = readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8');
      expect({ name, violations: historyViolations(sql) }).toEqual({
        name,
        violations: ALLOWED[name]?.violations ?? [],
      });
    }
  });

  it('keeps no entry for a migration that is gone', () => {
    for (const name of [...FROZEN, ...Object.keys(ALLOWED)]) expect(migrations).toContain(name);
  });

  it.each([
    ['UPDATE sessions SET observations = NULL;', 'UPDATE'],
    ['UPDATE "session_episodes" SET treatment = NULL;', 'UPDATE'],
    ['DELETE FROM public.sessions WHERE true;', 'DELETE'],
    ['TRUNCATE TABLE session_episodes;', 'TRUNCATE'],
    ['ALTER TABLE "sessions" DROP COLUMN "observations";', 'DROP COLUMN'],
    ['ALTER TABLE "sessions" ALTER COLUMN "session_date" TYPE date;', 'ALTER COLUMN TYPE'],
    ['ALTER TABLE "sessions" ALTER COLUMN "session_date" SET DATA TYPE date;', 'ALTER COLUMN TYPE'],
  ])('notices %s', (sql, kind) => {
    expect(historyViolations(sql)[0]).toMatch(new RegExp(`^${kind}:`));
  });

  it.each([
    'ALTER TABLE "sessions" ADD COLUMN "room" TEXT;',
    'ALTER TABLE "session_revisions" ADD CONSTRAINT x FOREIGN KEY (a) REFERENCES "sessions"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;',
    'CREATE TRIGGER t BEFORE UPDATE OR DELETE ON public.session_revisions FOR EACH ROW EXECUTE FUNCTION f();',
    '-- UPDATE sessions SET observations = NULL;',
  ])('lets %s through', (sql) => {
    expect(historyViolations(sql)).toEqual([]);
  });
});
