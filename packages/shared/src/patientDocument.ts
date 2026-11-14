// The document that identifies a patient: a type and a number, both or
// neither. A newborn has none yet; a foreigner has a passport or her
// country's id. The API validates and normalizes with this, and the web
// checks the form with it before sending.
//
// A clinic cannot hold two patients with the same document: the number is
// stored in one canonical form, so "12.345.678" and "12345678" are the same.

export const DOCUMENT_TYPES = ['DNI', 'PASSPORT', 'FOREIGN_ID', 'OTHER'] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  DNI: 'DNI',
  PASSPORT: 'Pasaporte',
  FOREIGN_ID: 'Documento extranjero',
  OTHER: 'Otro',
};

export type NormalizedDocumentNumber = { ok: true; number: string } | { ok: false; error: string };

/**
 * The number as it is stored. A DNI is its digits, without the dots or spaces
 * people write it with. Any other document keeps its letters, in capitals,
 * its digits and its hyphens, without spaces or dots.
 */
export function normalizeDocumentNumber(type: DocumentType, raw: string): NormalizedDocumentNumber {
  const compact = raw.replace(/[\s.]/g, '');
  if (type === 'DNI') {
    return /^\d{6,9}$/.test(compact)
      ? { ok: true, number: compact }
      : { ok: false, error: 'El DNI debe tener entre 6 y 9 dígitos' };
  }
  const number = compact.toUpperCase();
  return /^[A-Z0-9-]{3,30}$/.test(number)
    ? { ok: true, number }
    : { ok: false, error: 'El número de documento debe tener entre 3 y 30 letras, números o guiones' };
}
