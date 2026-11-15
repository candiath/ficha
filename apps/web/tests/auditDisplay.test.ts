import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, type AuditActionDef } from '@ficha/shared';
import { auditDisplay } from '@/lib/auditDisplay';

// How a patient's history reads (#186, SPEC-audit-structured-entries.md §5).
describe('auditDisplay', () => {
  it('builds label, sentence and colour from the codes', () => {
    expect(
      auditDisplay('audit_logs', {
        action: 'SESSION_UPDATED',
        params: { sessionType: 'DISCHARGE', changedFields: ['painScaleAfter'] },
      }),
    ).toEqual({ label: 'Sesión actualizada', text: 'Actualizó el dolor al final del alta', kind: 'update' });
  });

  it('paints a deletion as a deletion', () => {
    expect(auditDisplay('audit_logs', { action: 'PATIENT_DELETED', params: {} }).kind).toBe('delete');
  });

  // No action is deprecated today; a made-up one stands in for the day one is.
  it('reads the rows of a deprecated action', () => {
    const audit = AUDIT_ACTIONS.audit_logs as unknown as Record<string, AuditActionDef>;
    audit.LEGACY_TEST_ACTION = {
      deprecated: true,
      kind: 'create',
      params: {},
      label: 'Acción antigua',
      describe: () => 'Hizo algo antiguo',
    };
    try {
      expect(auditDisplay('audit_logs', { action: 'LEGACY_TEST_ACTION', params: {} })).toEqual({
        label: 'Acción antigua',
        text: 'Hizo algo antiguo',
        kind: 'create',
      });
    } finally {
      delete audit.LEGACY_TEST_ACTION;
    }
  });

  it('reads a row with no parameters with the generic sentence of its action', () => {
    expect(auditDisplay('audit_logs', { action: 'PATIENT_UPDATED', params: {} }).text).toBe(
      'Actualizó la ficha del paciente',
    );
  });

  it('never shows the raw code of an action it does not know', () => {
    expect(auditDisplay('audit_logs', { action: 'FUTURE_ACTION', params: {} })).toEqual({
      label: 'Acción registrada',
      text: 'Acción registrada',
      kind: null,
    });
  });
});
