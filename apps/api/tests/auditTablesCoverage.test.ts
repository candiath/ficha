import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import {
  AUDIT_ENUMS,
  AUDIT_FUNCTIONS,
  AUDIT_TABLE_NAME,
  AUDIT_TABLES,
  NON_AUDIT_FUNCTIONS,
  NON_AUDIT_TRIGGER_TABLES,
  STAMPED_AUDIT_TABLES,
} from './auditTables';

// The lists of tests/auditTables.ts against what the migrations deployed, as
// tenantScopeCoverage.test.ts does for the tenant guard. A new audit table
// gets its triggers in a migration; if it is then missing from audit-guards.sql
// or from the migration scan, nothing fails: its triggers can be switched off,
// or a column rewritten, unseen. Here it fails.

const guards = readFileSync(join(__dirname, '..', 'prisma', 'audit-guards.sql'), 'utf8');

const sorted = (values: Iterable<string>) => [...values].sort();
const without = (values: readonly string[], exempt: Readonly<Record<string, string>>) =>
  values.filter((v) => !Object.hasOwn(exempt, v));

// The public tables with a trigger calling this function, or with any trigger.
async function tablesWithTrigger(fn?: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table: string; fn: string }[]>`
    SELECT c.relname::text AS table, p.proname::text AS fn
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND n.nspname = 'public'`;
  return sorted(new Set(rows.filter((r) => fn === undefined || r.fn === fn).map((r) => r.table)));
}

describe('the audit tables are listed everywhere they are checked', () => {
  it('every table with a trigger is an audit table, and every audit table is append-only', async () => {
    expect(without(await tablesWithTrigger(), NON_AUDIT_TRIGGER_TABLES)).toEqual(sorted(AUDIT_TABLES));
    expect(await tablesWithTrigger('audit_rows_are_append_only')).toEqual(sorted(AUDIT_TABLES));
  });

  it('every table with created_at stamped by the database is listed as such, and the reverse', async () => {
    expect(await tablesWithTrigger('audit_rows_stamp_created_at')).toEqual(sorted(STAMPED_AUDIT_TABLES));
  });

  it('every table named like an audit table is one', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT tablename::text AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
    const named = rows.map((r) => r.name).filter((name) => AUDIT_TABLE_NAME.test(name));
    expect(named.filter((name) => !AUDIT_TABLES.includes(name))).toEqual([]);
  });

  // The declarations, and the trigger set each table is checked against: that
  // loop is also where rules, row-level security, persistence, child tables and
  // restricting foreign keys are checked.
  it('audit-guards.sql checks exactly the audit tables, each with its append-only triggers', () => {
    const declared = [...guards.matchAll(/to_regclass\('public\.([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(sorted(declared)).toEqual(sorted(AUDIT_TABLES));

    const stamped: readonly string[] = STAMPED_AUDIT_TABLES;
    for (const table of AUDIT_TABLES) {
      const expected = [
        `'${table}_append_only 27 public.audit_rows_are_append_only()`,
        `'${table}_no_truncate 34 public.audit_rows_are_append_only()`,
        ...(stamped.includes(table) ? [`'${table}_stamp_created_at 7 public.audit_rows_stamp_created_at()`] : []),
      ];
      expect({ table, missing: expected.filter((line) => !guards.includes(line)) }).toEqual({ table, missing: [] });
    }
  });

  // The migration scan sees an index by its name starting with its table's.
  it('every index on an audit table is named after it', async () => {
    const rows = await prisma.$queryRaw<{ index: string; table: string }[]>`
      SELECT i.relname::text AS index, t.relname::text AS table
        FROM pg_catalog.pg_index x
        JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relname = ANY(${[...AUDIT_TABLES]})`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.index.startsWith(`${r.table}_`))).toEqual([]);
  });

  // A helper a trigger function calls is not in pg_depend: every function of
  // the schema is listed or exempt, extensions' aside.
  it('every function of the public schema is an audit function, unless exempt', async () => {
    const rows = await prisma.$queryRaw<{ fn: string }[]>`
      SELECT DISTINCT p.proname::text AS fn
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                          WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`;
    expect(without(sorted(rows.map((r) => r.fn)), NON_AUDIT_FUNCTIONS)).toEqual(sorted(AUDIT_FUNCTIONS));
  });

  it("every function an audit table's triggers or CHECKs call is listed", async () => {
    const rows = await prisma.$queryRaw<{ fn: string }[]>`
      SELECT p.proname::text AS fn
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = ANY(${[...AUDIT_TABLES]})
      UNION
      SELECT p.proname::text
        FROM pg_catalog.pg_constraint k
        JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_constraint'::regclass AND d.objid = k.oid
                                   AND d.refclassid = 'pg_catalog.pg_proc'::regclass
        JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
       WHERE k.contype = 'c' AND n.nspname = 'public' AND c.relname = ANY(${[...AUDIT_TABLES]})`;
    const listed: readonly string[] = AUDIT_FUNCTIONS;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.fn).filter((fn) => !listed.includes(fn))).toEqual([]);
  });

  it('audit-guards.sql pins exactly the listed functions', () => {
    const pinned = [...guards.matchAll(/\('public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(sorted(pinned)).toEqual(sorted(AUDIT_FUNCTIONS));
  });

  // Arrays of an enum count: renaming a value rewrites what they hold too.
  it("every enum of an audit table's columns is listed, and the reverse", async () => {
    const rows = await prisma.$queryRaw<{ type: string }[]>`
      SELECT DISTINCT coalesce(elem.typname, ty.typname)::text AS type
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
        LEFT JOIN pg_catalog.pg_type elem ON elem.oid = ty.typelem AND ty.typcategory = 'A'
       WHERE n.nspname = 'public' AND c.relname = ANY(${[...AUDIT_TABLES]})
         AND a.attnum > 0 AND NOT a.attisdropped
         AND coalesce(elem.typtype, ty.typtype) = 'e'`;
    expect(sorted(rows.map((r) => r.type))).toEqual(sorted(AUDIT_ENUMS));
  });
});
