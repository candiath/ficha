import {
  AuditAction,
  AuditEntity,
  AppointmentStatus,
  EpisodeStatus,
  PatientEventKind,
  PaymentStatus,
  PlatformAction,
  PlatformAuditEntity,
  SessionType,
  UserRole,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_APPOINTMENT_FIELDS,
  AUDIT_APPOINTMENT_STATUSES,
  AUDIT_EPISODE_FIELDS,
  AUDIT_EPISODE_STATUSES,
  AUDIT_EVALUATION_FIELDS,
  AUDIT_PATIENT_EVENT_FIELDS,
  AUDIT_PATIENT_EVENT_KINDS,
  AUDIT_PATIENT_FIELDS,
  AUDIT_PAYMENT_FIELDS,
  AUDIT_PAYMENT_STATUSES,
  AUDIT_REVISION_REASONS,
  AUDIT_ROLES,
  AUDIT_SCALE_TYPES,
  AUDIT_SESSION_FIELDS,
  AUDIT_SESSION_TYPES,
  type AuditActionDef,
  auditActionLabel,
  auditEntryProblem,
  describeAuditEntry,
  readAuditParams,
  revisionReasonSchema,
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
    ['SessionType', SessionType, AUDIT_SESSION_TYPES],
    ['PaymentStatus', PaymentStatus, AUDIT_PAYMENT_STATUSES],
    ['UserRole', UserRole, AUDIT_ROLES],
    ['PatientEventKind', PatientEventKind, AUDIT_PATIENT_EVENT_KINDS],
    ['AppointmentStatus', AppointmentStatus, AUDIT_APPOINTMENT_STATUSES],
  ] as const)('every %s value has a label in the catalog', (_name, prismaEnum, labels) => {
    for (const value of Object.values(prismaEnum)) expect(Object.keys(labels)).toContain(value);
  });

  // ACTIVE is not a status an episode is closed with: reopening has its own action.
  it('every EpisodeStatus an episode can be closed with has a label in the catalog', () => {
    for (const value of Object.values(EpisodeStatus).filter((s) => s !== 'ACTIVE')) {
      expect(Object.keys(AUDIT_EPISODE_STATUSES)).toContain(value);
    }
  });

  it('every field name is camelCase letters, as the database check requires', () => {
    for (const fields of [
      AUDIT_PATIENT_FIELDS,
      AUDIT_EVALUATION_FIELDS,
      AUDIT_SESSION_FIELDS,
      AUDIT_PAYMENT_FIELDS,
      AUDIT_PATIENT_EVENT_FIELDS,
      AUDIT_EPISODE_FIELDS,
      AUDIT_APPOINTMENT_FIELDS,
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
      AUDIT_EPISODE_STATUSES,
      AUDIT_APPOINTMENT_STATUSES,
      AUDIT_REVISION_REASONS,
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
    expect(auditEntryProblem('audit_logs', 'PATIENT_EVENT_RECORDED', { kind: 'FRACTURE' })).toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_UPDATED', { changedFields: ['phone'] })).toBeNull();
  });

  it('refuses unknown and deprecated actions', () => {
    expect(auditEntryProblem('audit_logs', 'VIEWED', {})).toMatch(/unknown/);
    expect(auditEntryProblem('audit_logs', 'CREATED', {})).toMatch(/deprecated/);
    expect(auditEntryProblem('platform_audit_logs', 'USER_ACTIVE_CHANGED', {})).toMatch(/deprecated/);
    expect(auditEntryProblem('audit_logs', 'SCALE_APPLIED', { scaleType: 'NDI' })).toMatch(/deprecated/);
    // A code is unique per table, not across them.
    expect(auditEntryProblem('platform_audit_logs', 'PATIENT_CREATED', {})).toMatch(/unknown/);
  });

  it('refuses free text, unknown keys, unknown values and an empty change list', () => {
    expect(auditEntryProblem('audit_logs', 'PATIENT_EVENT_RECORDED', { kind: 'Fractura de tibia' })).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_EVENT_RECORDED', { kind: 'FRACTURE', year: 2024 })).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_EVENT_RECORDED', {})).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_UPDATED', { changedFields: [] })).not.toBeNull();
    expect(auditEntryProblem('audit_logs', 'PATIENT_UPDATED', { changedFields: ['password'] })).not.toBeNull();
  });

  it('never repeats the value it refused', () => {
    expect(auditEntryProblem('audit_logs', 'PATIENT_EVENT_RECORDED', { kind: 'juan@x.com' })).not.toContain('juan');
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

  it("an episode's actions read as what was done to it", () => {
    expect(describeAuditEntry('audit_logs', 'APPOINTMENT_UPDATED', { status: 'NO_SHOW', changedFields: ['status'] })).toBe(
      'Actualizó el estado de un turno (no asistió)',
    );
    expect(describeAuditEntry('audit_logs', 'EPISODE_CLOSED', { status: 'DISCHARGED' })).toBe('Cerró un episodio (alta)');
    expect(describeAuditEntry('audit_logs', 'EPISODE_CLOSED', { status: 'ABANDONED' })).toBe('Cerró un episodio (abandono)');
    expect(describeAuditEntry('audit_logs', 'EPISODE_UPDATED', { changedFields: ['mainComplaint', 'closedAt'] })).toBe(
      'Actualizó el motivo de consulta y la fecha de cierre de un episodio',
    );
  });
});

// The body of a correction or an annulment carries its reason
// (SPEC-clinical-revisions.md §4): a code from the catalog, and an optional
// note under the API's single-empty rule.
describe('the reason of a revision', () => {
  it('requires a code from the catalog', () => {
    for (const reason of Object.keys(AUDIT_REVISION_REASONS)) {
      expect(revisionReasonSchema.parse({ reason })).toEqual({ reason });
    }
    expect(revisionReasonSchema.safeParse({}).success).toBe(false);
    expect(revisionReasonSchema.safeParse({ reason: 'Error de confección' }).success).toBe(false);
    expect(revisionReasonSchema.safeParse({ reason: 'OTHER', extra: 'x' }).success).toBe(false);
  });

  it('keeps a note absent when it is absent, and empty as null', () => {
    expect(revisionReasonSchema.parse({ reason: 'OTHER' })).not.toHaveProperty('reasonNote');
    expect(revisionReasonSchema.parse({ reason: 'OTHER', reasonNote: '   ' })).toEqual({ reason: 'OTHER', reasonNote: null });
    expect(revisionReasonSchema.parse({ reason: 'OTHER', reasonNote: null })).toEqual({ reason: 'OTHER', reasonNote: null });
    expect(revisionReasonSchema.parse({ reason: 'CLARIFICATION', reasonNote: '  Dato del médico  ' })).toEqual({
      reason: 'CLARIFICATION',
      reasonNote: 'Dato del médico',
    });
  });

  it('limits the note to 500 characters, measured after the trim', () => {
    expect(revisionReasonSchema.safeParse({ reason: 'OTHER', reasonNote: ` ${'x'.repeat(500)} ` }).success).toBe(true);
    expect(revisionReasonSchema.safeParse({ reason: 'OTHER', reasonNote: 'x'.repeat(501) }).success).toBe(false);
  });
});
