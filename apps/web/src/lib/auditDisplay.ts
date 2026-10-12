import {
  auditActionKind,
  auditActionLabel,
  describeAuditEntry,
  type AuditKind,
  type AuditTable,
} from '@ficha/shared';

// How an audit row reads on screen (#186, SPEC-audit-structured-entries.md §5):
// the label and the sentence come from the catalog in @ficha/shared, built from
// the row's codes. An action this version does not know reads as "Acción
// registrada", never as the raw code.
export interface AuditDisplay {
  label: string;
  text: string;
  /** For the colour; null for an action this version does not know. */
  kind: AuditKind | null;
}

export function auditDisplay(
  table: AuditTable,
  entry: { action: string; params: unknown },
): AuditDisplay {
  return {
    label: auditActionLabel(table, entry.action),
    text: describeAuditEntry(table, entry.action, entry.params),
    kind: auditActionKind(table, entry.action),
  };
}
