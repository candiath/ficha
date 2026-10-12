import {
  auditActionKind,
  auditActionLabel,
  describeAuditEntry,
  type AuditKind,
  type AuditTable,
} from '@ficha/shared';

// How an audit row reads on screen (#186, SPEC-audit-structured-entries.md §5):
// the label and the sentence come from the catalog in @ficha/shared, built from
// the row's codes. A row from an API that predates the catalog has no params,
// only its own sentence, and that is shown instead. An action this version
// does not know reads as "Acción registrada", never as the raw code.
export interface AuditDisplay {
  label: string;
  text: string;
  /** For the colour; null for an action this version does not know. */
  kind: AuditKind | null;
}

export function auditDisplay(
  table: AuditTable,
  entry: { action: string; params?: unknown; description?: string | null },
): AuditDisplay {
  return {
    label: auditActionLabel(table, entry.action),
    text:
      entry.params !== undefined
        ? describeAuditEntry(table, entry.action, entry.params)
        : (entry.description ?? 'Acción registrada'),
    kind: auditActionKind(table, entry.action),
  };
}
