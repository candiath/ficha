import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import {
  AUDIT_ENUMS,
  AUDIT_FUNCTIONS,
  AUDIT_TABLE_NAME,
  AUDIT_TABLES,
  STAMPED_AUDIT_TABLES,
} from './auditTables';

// The lists of tests/auditTables.ts against what the migrations deployed, as
// tenantScopeCoverage.test.ts does for the tenant guard. A new audit table
// gets its triggers in a migration; if it is then missing from audit-guards.sql
// or from the migration scan, nothing fails: its triggers can be switched off,
// or a column rewritten, unseen. Here it fails.

const guards = readFileSync(join(__dirname, '..', 'prisma', 'audit-guards.sql'), 'utf8');

const sorted = (values: Iterable<string>) => [...values].sort();

// The tables whose rows a trigger calling this function protects.
async function tablesWithTrigger(fn: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table: string }[]>`
    SELECT DISTINCT c.relname AS table
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND n.nspname = 'public' AND p.proname = ${fn}`;
  return sorted(rows.map((r) => r.table));
}

describe('the audit tables are listed everywhere they are checked', () => {
  it('every table with the append-only trigger is an audit table, and the reverse', async () => {
    expect(await tablesWithTrigger('audit_rows_are_append_only')).toEqual(sorted(AUDIT_TABLES));
  });

  it('every table with created_at stamped by the database is listed as such, and the reverse', async () => {
    expect(await tablesWithTrigger('audit_rows_stamp_created_at')).toEqual(sorted(STAMPED_AUDIT_TABLES));
  });

  it('every table named like an audit table is one', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public'`;
    const named = rows.map((r) => r.name).filter((name) => AUDIT_TABLE_NAME.test(name));
    expect(named.filter((name) => !AUDIT_TABLES.includes(name))).toEqual([]);
  });

  it('audit-guards.sql checks exactly the audit tables', () => {
    const checked = [...guards.matchAll(/to_regclass\('public\.([a-z_]+)'\)/g)].map((m) => m[1]);
    expect(sorted(checked)).toEqual(sorted(AUDIT_TABLES));
  });

  // The migration scan sees an index by its name starting with its table's.
  it('every index audit-guards.sql pins is on an audit table and named after it', () => {
    const pinned = [...guards.matchAll(/CREATE UNIQUE INDEX (\w+) ON public\.(\w+)/g)].map((m) => ({
      index: m[1],
      table: m[2],
    }));
    expect(pinned.length).toBeGreaterThan(0);
    for (const { index, table } of pinned) {
      expect({ index, table, audit: AUDIT_TABLES.includes(table), prefixed: index.startsWith(`${table}_`) }).toEqual({
        index,
        table,
        audit: true,
        prefixed: true,
      });
    }
  });

  it('every function a trigger on an audit table calls is listed', async () => {
    const rows = await prisma.$queryRaw<{ fn: string }[]>`
      SELECT DISTINCT p.proname AS fn
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname = ANY(${[...AUDIT_TABLES]})`;
    const listed: readonly string[] = AUDIT_FUNCTIONS;
    expect(rows.map((r) => r.fn).filter((fn) => !listed.includes(fn))).toEqual([]);
  });

  it('audit-guards.sql pins exactly the listed functions', () => {
    const pinned = [...guards.matchAll(/\('public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(sorted(pinned)).toEqual(sorted(AUDIT_FUNCTIONS));
  });

  it("every enum of an audit table's columns is listed, and the reverse", async () => {
    const rows = await prisma.$queryRaw<{ type: string }[]>`
      SELECT DISTINCT udt_name::text AS type
        FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'USER-DEFINED' AND table_name::text = ANY(${[...AUDIT_TABLES]})`;
    expect(sorted(rows.map((r) => r.type))).toEqual(sorted(AUDIT_ENUMS));
  });
});
