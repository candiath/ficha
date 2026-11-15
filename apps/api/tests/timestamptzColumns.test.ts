import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';

// Every timestamp column is timestamptz(3), an instant (20261116120000_timestamptz):
// a plain timestamp is a wall time that raw SQL and any session whose TimeZone
// is not UTC read and write in their own zone. Only calendar dates (@db.Date)
// are exempt. Prisma's default for DateTime is the plain one, so a new field
// that forgets @db.Timestamptz(3) fails here.

const SCHEMA = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

// The generated client's DMMF carries no native types, so the attributes are
// read from the schema file; the DMMF says which fields there are.
function dateTimeFieldsInFile(schema: string): { name: string; attributes: string }[] {
  const fields: { name: string; attributes: string }[] = [];
  let model: string | null = null;
  for (const raw of schema.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const opened = /^model\s+(\w+)\s*\{/.exec(line);
    if (opened) {
      model = opened[1];
      continue;
    }
    if (line === '}') model = null;
    const field = model ? /^(\w+)\s+DateTime\??(?:\s+(.*))?$/.exec(line) : null;
    if (field) fields.push({ name: `${model}.${field[1]}`, attributes: field[2] ?? '' });
  }
  return fields;
}

const inFile = dateTimeFieldsInFile(SCHEMA);
const isDate = (attributes: string) => /@db\.Date(?![\w(])/.test(attributes);

const dmmfDateTimes = Prisma.dmmf.datamodel.models.flatMap((m) =>
  m.fields
    .filter((f) => f.type === 'DateTime')
    .map((f) => ({ name: `${m.name}.${f.name}`, column: `${m.dbName ?? m.name}.${f.dbName ?? f.name}` })),
);

describe('every DateTime is a timestamptz(3), or a calendar date', () => {
  it('reads every DateTime field of the schema', () => {
    expect(inFile.map((f) => f.name).sort()).toEqual(dmmfDateTimes.map((f) => f.name).sort());
    expect(inFile.length).toBeGreaterThan(50);
  });

  it('declares @db.Timestamptz(3) or @db.Date on each', () => {
    const offending = inFile
      .filter((f) => !isDate(f.attributes) && !/@db\.Timestamptz\(3\)/.test(f.attributes))
      .map((f) => `${f.name} ${f.attributes}`);
    expect(offending).toEqual([]);
  });

  it('the migrations built exactly that: no plain timestamp, every instant to the millisecond', async () => {
    const dates = new Set(inFile.filter((f) => isDate(f.attributes)).map((f) => f.name));
    const expected = dmmfDateTimes.filter((f) => !dates.has(f.name)).map((f) => f.column).sort();

    const columns = await prisma.$queryRaw<{ column: string; type: string; precision: number | null }[]>`
      SELECT table_name || '.' || column_name AS "column", data_type AS "type",
             datetime_precision::int AS "precision"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone')`;

    expect(columns.filter((c) => c.type === 'timestamp without time zone').map((c) => c.column)).toEqual([]);
    const instants = columns.filter((c) => c.type === 'timestamp with time zone' && c.precision === 3);
    expect(expected.filter((column) => !instants.some((c) => c.column === column))).toEqual([]);
  });
});

// What the type changes: SQL that is not Prisma's, in a session whose zone is
// not UTC (Neon's and the test container's are UTC, which hides the problem).
describe('a timestamp means the same instant in every session', () => {
  const key = `timestamptz-test:${randomUUID()}`;

  afterAll(async () => {
    await prisma.loginEvent.deleteMany({ where: { key } });
  });

  it('a column default stores the current instant, not the local wall time', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TimeZone = 'America/Argentina/Buenos_Aires'`;
      await tx.$executeRaw`
        INSERT INTO login_events (id, key, email, success)
        VALUES (uuidv7(), ${key}, 'nobody@test.ficha.local', false)`;
    });

    const [{ age }] = await prisma.$queryRaw<{ age: number }[]>`
      SELECT extract(epoch FROM now() - created_at)::float8 AS age FROM login_events WHERE key = ${key}`;
    // A plain timestamp would hold Buenos Aires' wall time: three hours off.
    expect(Math.abs(age)).toBeLessThan(60);
  });

  it('raw SQL compares a Prisma-written value with now() as the instant it is', async () => {
    const { id } = await prisma.loginEvent.create({
      data: { key, email: 'nobody@test.ficha.local', success: false, createdAt: new Date() },
      select: { id: true },
    });

    const [{ fresh }] = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TimeZone = 'Asia/Tokyo'`;
      return tx.$queryRaw<{ fresh: boolean }[]>`
        SELECT created_at > now() - interval '1 minute' AND created_at < now() + interval '1 minute' AS fresh
        FROM login_events WHERE id = ${id}::uuid`;
    });
    // A plain timestamp would be read as Tokyo's wall time: nine hours early.
    expect(fresh).toBe(true);
  });
});
