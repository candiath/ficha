import {
  AuditAction,
  AuditEntity,
  PatientEventKind,
  PaymentStatus,
  PlatformAction,
  PlatformAuditEntity,
  ScaleType,
  SessionType,
  UserRole,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_EVALUATION_FIELDS,
  AUDIT_PATIENT_EVENT_FIELDS,
  AUDIT_PATIENT_EVENT_KINDS,
  AUDIT_PATIENT_FIELDS,
  AUDIT_PAYMENT_FIELDS,
  AUDIT_PAYMENT_STATUSES,
  AUDIT_ROLES,
  AUDIT_SCALE_TYPES,
  AUDIT_SESSION_FIELDS,
  AUDIT_SESSION_TYPES,
  type AuditActionDef,
  auditActionLabel,
  auditEntryProblem,
  describeAuditEntry,
  readAuditParams,
} from '@ficha/shared';

// The catalog of audit actions (packages/shared/src/auditActions.ts) against
// the schema, as tenantScopeCoverage.test.ts does for the tenant guard
// (#186, SPEC-audit-structured-entries.md §6). An action in the database with
// no wording would render as "Acción registrada"; a value a parameter mirrors
// that the catalog lacks would make the clinical write itself fail.

const section = (table: keyof typeof AUDIT_ACTIONS) =>
  AUDIT_ACTIONS[table] as Readonly<Record<string, AuditActionDef>>;

describe('the audit catalog matches the schema', () => {
  it('every audit_logs action is in the catalog, and the reverse', () => {
    expect(Object.keys(section('audit_logs')).sort()).toEqual(Object.values(AuditAction).sort());
  });

  it('every platform_audit_logs action is in the catalog, and the reverse', () => {
    expect(Object.keys(section('platform_audit_logs')).sort()).toEqual(Object.values(PlatformAction).sort());
  });

  it('every audit_logs action that can be written names an entity of AuditEntity', () => {
    for (const [code, def] of Object.entries(section('audit_logs'))) {
      if (def.deprecated) continue;
      expect({ code, entity: def.entity && Object.values(AuditEntity).includes(def.entity as AuditEntity) }).toEqual({
        code,
        entity: true,
      });
    }
  });

  it('a platform action names an entity of PlatformAuditEntity, or none', () => {
    for (const [code, def] of Object.entries(section('platform_audit_logs'))) {
      if (def.entity === undefined) continue;
      expect({ code, ok: Object.values(PlatformAuditEntity).includes(def.entity as PlatformAuditEntity) }).toEqual({
        code,
        ok: true,
      });
    }
  });

  // The catalog's lists may hold more (a value the domain dropped keeps its
  // label for the rows that name it), never fewer.
  it.each([
    ['ScaleType', ScaleType, AUDIT_SCALE_TYPES],
    ['SessionType', SessionType, AUDIT_SESSION_TYPES],
    ['PaymentStatus', PaymentStatus, AUDIT_PAYMENT_STATUSES],
    ['UserRole', UserRole, AUDIT_ROLES],
    ['PatientEventKind', PatientEventKind, AUDIT_PATIENT_EVENT_KINDS],
  ] as const)('every %s value has a label in the catalog', (_name, prismaEnum, labels) => {
    for (const value of Object.values(prismaEnum)) expect(Object.keys(labels)).toContain(value);
  });

  it('every field name is camelCase letters, as the database check requires', () => {
    for (const fields of [
      AUDIT_PATIENT_FIELDS,
      AUDIT_EVALUATION_FIELDS,
      AUDIT_SESSION_FIELDS,
      AUDIT_PAYMENT_FIELDS,
      AUDIT_PATIENT_EVENT_FIELDS,
    ]) {
      for (const name of Object.keys(fields)) expect(name).toMatch(/^[a-z][A-Za-z]{0,63}$/);
    }
  });

  it('every code value is upper case, with no three digits in a row', () => {
    for (const values of [
      AUDIT_SCALE_TYPES,
      AUDIT_SESSION_TYPES,
      AUDIT_PAYMENT_STATUSES,
      AUDIT_ROLES,
      AUDIT_PATIENT_EVENT_KINDS,
    ]) {
      for (const value of Object.keys(values)) {
        expect(value).toMatch(/^[A-Z][A-Z0-9_]{0,63}$/);
        expect(value).not.toMatch(/[0-9]{3}/);
      }
    }
  });
});

describe('writing is strict', () => {
  it('accepts an action with its parameters', () => {
    expect(auditEntryProblem('audit_logs', 'SCALE_APPLIED', { scaleType: 'NDI' })).toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_UPDATED', { changedFields: ['phone'] })).toBeNull();
  });

  it('refuses unknown and deprecated actions', () => {
    expect(auditEntryProblem('audit_logs', 'VIEWED', {})).toMatch(/unknown/);
    expect(auditEntryProblem('audit_logs', 'CREATED', {})).toMatch(/deprecated/);
    expect(auditEntryProblem('platform_audit_logs', 'USER_ACTIVE_CHANGED', {})).toMatch(/deprecated/);
    // A code is unique per table, not across them.
    expect(auditEntryProblem('platform_audit_logs', 'PATIENT_CREATED', {})).toMatch(/unknown/);
  });

  it('refuses free text, unknown keys, unknown values and an empty change list', () => {
    expect(auditEntryProblem('audit_logs', 'SCALE_APPLIED', { scaleType: 'Oswestry 42%' })).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'SCALE_APPLIED', { scaleType: 'NDI', score: 42 })).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'SCALE_APPLIED', {})).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_UPDATED', { changedFields: [] })).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_UPDATED', { changedFields: ['password'] })).not.toBeNull();
  });

  it('never repeats the value it refused', () => {
    expect(auditEntryProblem('audit_logs', 'SCALE_APPLIED', { scaleType: 'juan@x.com' })).not.toContain('juan');
  });
});

describe('reading is lenient', () => {
  it('drops what it does not know, parameter by parameter', () => {
    expect(
      readAuditParams('audit_logs', 'SESSION_UPDATED', {
        sessionType: 'FUTURE_TYPE',
        changedFields: ['painScaleAfter', 'futureField'],
        extra: 'x',
      }),
    ).toEqual({ changedFields: ['painScaleAfter'] });
  });

  it('reads anything that is not an object as no parameters', () => {
    for (const raw of [null, 'x', 3, ['a']]) expect(readAuditParams('audit_logs', 'SCALE_APPLIED', raw)).toEqual({});
  });

  it('every action has a sentence with none of its parameters', () => {
    for (const table of ['audit_logs', 'platform_audit_logs'] as const) {
      for (const code of Object.keys(section(table))) {
        expect(describeAuditEntry(table, code, {})).toMatch(/\S/);
      }
    }
  });

  it('an unknown action reads as a neutral one, never the raw code', () => {
    expect(describeAuditEntry('audit_logs', 'FUTURE_ACTION', {})).toBe('Acción registrada');
    expect(auditActionLabel('platform_audit_logs', 'FUTURE_ACTION')).toBe('Acción registrada');
  });
});
