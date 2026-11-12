import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The maintenance flag (ficha_ops.audit_maintenance_allowed) exists only in
// development and ci, created by hand (docs/infra.md#audit-tables). A
// migration that created it would deploy it to production with every other
// migration; the build checks again after migrating (db:migrate:prod), and
// this keeps such a migration from being written at all (area 3 review, L2).
const MIGRATIONS = path.join(__dirname, '..', 'prisma', 'migrations');
const CREATES_FLAG = /\bCREATE\s+(SCHEMA|TABLE|VIEW)\b[^;]*\b(ficha_ops|audit_maintenance_allowed)\b/i;

describe('no migration creates the audit maintenance flag', () => {
  const files = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(MIGRATIONS, d.name, 'migration.sql'));

  it('reads the migrations', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('none of them creates ficha_ops or the flag table', () => {
    const offending = files.filter((f) => {
      // Comments are not statements.
      const sql = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
      return CREATES_FLAG.test(sql);
    });
    expect(offending.map((f) => path.basename(path.dirname(f)))).toEqual([]);
  });

  it('would catch one that did', () => {
    expect(CREATES_FLAG.test('CREATE SCHEMA ficha_ops;')).toBe(true);
    expect(CREATES_FLAG.test('CREATE TABLE IF NOT EXISTS ficha_ops.audit_maintenance_allowed ();')).toBe(true);
    expect(CREATES_FLAG.test("SELECT to_regclass('ficha_ops.audit_maintenance_allowed')")).toBe(false);
  });
});
