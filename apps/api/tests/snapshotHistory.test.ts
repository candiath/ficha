import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeDocumentNumber, snapshotHistory } from '@ficha/shared';

// How a stored snapshot of any schema version reads in the current shape
// (packages/shared clinicalSnapshots.ts). The three kinds of change a clinical
// aggregate will meet, on a made-up aggregate: a field added, a field removed,
// and an enum that gains a value.
const V1 = z.strictObject({ name: z.string(), status: z.enum(['OPEN', 'CLOSED']), legacy: z.string().nullable() });
const V2 = z.strictObject({ ...V1.shape, document: z.string().nullable() });
const V3 = z.strictObject({ name: z.string(), status: z.enum(['OPEN', 'CLOSED']), document: z.string().nullable() });
const V4 = z.strictObject({ ...V3.shape, status: z.enum(['OPEN', 'CLOSED', 'SUSPENDED']) });

type V1 = z.infer<typeof V1>;
type V2 = z.infer<typeof V2>;
type V3 = z.infer<typeof V3>;
type V4 = z.infer<typeof V4>;

const history = snapshotHistory<V4>([
  { schema: V1 },
  { schema: V2, upcast: (v1: V1): V2 => ({ ...v1, document: null }) },
  { schema: V3, upcast: ({ legacy: _legacy, ...rest }: V2): V3 => rest },
  { schema: V4, upcast: (v3: V3): V4 => v3 },
]);

describe('snapshotHistory', () => {
  it('writes with the last version', () => {
    expect(history.version).toBe(4);
    expect(history.schema).toBe(V4);
  });

  it('reads every version in the current shape', () => {
    const current = { name: 'Ana', status: 'OPEN', document: null };

    expect(history.read(1, { name: 'Ana', status: 'OPEN', legacy: 'x' })).toEqual(current);
    expect(history.read(2, { name: 'Ana', status: 'OPEN', legacy: 'x', document: null })).toEqual(current);
    expect(history.read(3, { name: 'Ana', status: 'OPEN', document: null })).toEqual(current);
    expect(history.read(4, { name: 'Ana', status: 'SUSPENDED', document: '1' })).toEqual({
      name: 'Ana',
      status: 'SUSPENDED',
      document: '1',
    });
  });

  it('does not change what it was given', () => {
    const stored = { name: 'Ana', status: 'OPEN', legacy: 'x' };
    history.read(1, stored);
    expect(stored).toEqual({ name: 'Ana', status: 'OPEN', legacy: 'x' });
  });

  it('answers null for a version it does not know', () => {
    const snapshot = { name: 'Ana', status: 'OPEN', document: null };
    for (const version of [0, 5, -1, 1.5, Number.NaN]) expect(history.read(version, snapshot), String(version)).toBeNull();
  });

  it('answers null for a snapshot that is not what its version says', () => {
    // A version 1 row cannot hold a field version 2 added, nor a value version 4 did.
    expect(history.read(1, { name: 'Ana', status: 'OPEN', legacy: null, document: null })).toBeNull();
    expect(history.read(3, { name: 'Ana', status: 'SUSPENDED', document: null })).toBeNull();
    expect(history.read(4, null)).toBeNull();
    expect(history.read(4, 'Ana')).toBeNull();
  });

  it('answers null when an upcast builds something else than its schema', () => {
    const broken = snapshotHistory<V2>([
      { schema: V1 },
      // Forgets the field it exists to add.
      { schema: V2, upcast: (v1: V1) => v1 },
    ]);

    expect(broken.read(1, { name: 'Ana', status: 'OPEN', legacy: null })).toBeNull();
    expect(broken.read(2, { name: 'Ana', status: 'OPEN', legacy: null, document: null })).not.toBeNull();
  });

  it('answers null for an earlier version when a later one has no upcast', () => {
    const gap = snapshotHistory<V2>([{ schema: V1 }, { schema: V2 }]);

    expect(gap.read(1, { name: 'Ana', status: 'OPEN', legacy: null })).toBeNull();
  });
});

describe('normalizeDocumentNumber', () => {
  it('reads a DNI as its digits', () => {
    expect(normalizeDocumentNumber('DNI', '30.123.456')).toEqual({ ok: true, number: '30123456' });
    expect(normalizeDocumentNumber('DNI', ' 5 123 456 ')).toEqual({ ok: true, number: '5123456' });
  });

  it('refuses a DNI that is not 6 to 9 digits', () => {
    for (const raw of ['12345', '1234567890', '30123456A', '', '30-123-456']) {
      expect(normalizeDocumentNumber('DNI', raw).ok, raw).toBe(false);
    }
  });

  it('keeps the letters of any other document, in capitals', () => {
    expect(normalizeDocumentNumber('PASSPORT', 'aar 123456')).toEqual({ ok: true, number: 'AAR123456' });
    expect(normalizeDocumentNumber('FOREIGN_ID', '12.345.678-9')).toEqual({ ok: true, number: '12345678-9' });
    expect(normalizeDocumentNumber('OTHER', 'ab')).toMatchObject({ ok: false });
    expect(normalizeDocumentNumber('OTHER', 'ñandú 123')).toMatchObject({ ok: false });
  });
});
