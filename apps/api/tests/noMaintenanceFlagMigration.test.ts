import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The maintenance flag (ficha_ops.audit_maintenance_allowed) exists only in
// development and ci, created by hand (docs/infra.md#audit-tables). A
// migration that created it would deploy it with every other migration; the
// build checks again after migrating (db:migrate:prod), and this keeps such a
// migration from being written at all (#314).
//
// Any mention counts, not only a CREATE: a view, a sequence, a type, a rename
// or SET SCHEMA would all satisfy to_regclass(). The one migration that names
// it legitimately reads it inside the audit functions, and its count is pinned.
const MIGRATIONS = path.join(__dirname, '..', 'prisma', 'migrations');
const FLAG = /\b(ficha_ops|audit_maintenance_allowed)\b/gi;
const ALLOWED: Record<string, number> = {
  // audit_maintenance_on() reads to_regclass('ficha_ops.audit_maintenance_allowed').
  '20261010191055_audit_rows_enforced': 2,
};

// Comments are not statements: both forms go.
const withoutComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const mentions = (sql: string) => withoutComments(sql).match(FLAG)?.length ?? 0;

describe('no migration creates the audit maintenance flag', () => {
  const migrations = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, sql: readFileSync(path.join(MIGRATIONS, d.name, 'migration.sql'), 'utf8') }));

  it('reads the migrations', () => {
    expect(migrations.length).toBeGreaterThan(20);
  });

  it('none of them names the flag, but the one that reads it, as many times as it does', () => {
    const found = Object.fromEntries(migrations.map((m) => [m.name, mentions(m.sql)]).filter(([, n]) => n !== 0));
    expect(found).toEqual(ALLOWED);
  });

  it('would catch the ways to create it', () => {
    for (const sql of [
      'CREATE SCHEMA ficha_ops;',
      'CREATE UNLOGGED TABLE ficha_ops.audit_maintenance_allowed ();',
      'CREATE SEQUENCE "ficha_ops"."audit_maintenance_allowed";',
      'ALTER TABLE public.t SET SCHEMA ficha_ops;',
      'CREATE/**/TABLE x.audit_maintenance_allowed ();',
    ]) {
      expect(mentions(sql), sql).toBeGreaterThan(0);
    }
    expect(mentions('-- ficha_ops in a comment')).toBe(0);
  });
});
