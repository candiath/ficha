import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The audit maintenance switch stays out of the app (#186,
// docs/specs/SPEC-audit-hardening.md §1). Its name may appear only in the
// files listed below, and nowhere may it be set at session level or to
// anything but the current transaction's id: a value that outlives its
// transaction (through the pooler, to another request) must never match.

const API = path.join(__dirname, '..');
const REPO = path.join(API, '..', '..');

// Built by concatenation, so this file does not find itself.
const SWITCH = 'ficha.' + 'audit_maintenance';

const ALLOWED_FILES = new Set(
  [
    'apps/api/prisma/migrations/20261010191055_audit_rows_enforced/migration.sql',
    'apps/api/prisma/seed.ts',
    'apps/api/scripts/purge-test-audit.ts',
    'apps/api/tests/helpers.ts',
    'apps/api/tests/auditHardening.test.ts',
    'apps/api/tests/auditSwitchScan.test.ts',
  ],
);

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|sql|json|ya?ml|sh|toml|prisma)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [
  ...walk(API),
  ...walk(path.join(REPO, '.github')),
  path.join(REPO, 'package.json'),
].filter((file) => statSync(file).isFile());

const relative = (file: string) => path.relative(REPO, file).split(path.sep).join('/');

const escaped = SWITCH.replace('.', String.raw`\.`);
const SESSION_SET = new RegExp(String.raw`\bSET\s+(SESSION\s+|LOCAL\s+)?${escaped}\b`, 'i');
const SET_CONFIG = new RegExp(
  String.raw`set_config\(\s*'${escaped}'\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)`,
  'gi',
);

describe('the audit maintenance switch', () => {
  it('appears only in its listed files', () => {
    const found = files.filter((file) => readFileSync(file, 'utf8').includes(SWITCH)).map(relative);
    expect(found.filter((file) => !ALLOWED_FILES.has(file))).toEqual([]);
  });

  it('is never set at session level, nor to anything but the transaction id', () => {
    const misuses: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (SESSION_SET.test(source)) misuses.push(`${relative(file)}: SET`);
      for (const [call, value, local] of source.matchAll(SET_CONFIG)) {
        if (value !== 'pg_current_xact_id()::text' || local.toLowerCase() !== 'true') {
          misuses.push(`${relative(file)}: ${call}`);
        }
      }
    }
    expect(misuses).toEqual([]);
  });

  it('the scan sees what it must', () => {
    expect(files.map(relative)).toContain('apps/api/tests/helpers.ts');
    expect(files.map(relative)).toContain('.github/workflows/test.yml');
    expect(SESSION_SET.test(`SET ${SWITCH} = 'x'`)).toBe(true);
    expect(SESSION_SET.test(`RESET ${SWITCH}`)).toBe(false);
    const bad = `set_config('${SWITCH}', pg_current_xact_id()::text, false)`;
    expect([...bad.matchAll(SET_CONFIG)][0][2]).toBe('false');
  });
});
