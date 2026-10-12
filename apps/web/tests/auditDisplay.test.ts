import { describe, expect, it } from 'vitest';
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

  it('reads the rows written before the catalog', () => {
    expect(auditDisplay('audit_logs', { action: 'CREATED', params: {} })).toEqual({
      label: 'Creación',
      text: 'Registro creado',
      kind: 'create',
    });
  });

  it("uses an older API's sentence when the row has no codes", () => {
    expect(auditDisplay('audit_logs', { action: 'UPDATED', description: 'Ficha del paciente actualizada' }).text).toBe(
      'Ficha del paciente actualizada',
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
