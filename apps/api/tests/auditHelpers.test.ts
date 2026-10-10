import { describe, expect, it } from 'vitest';
import { deleteAuditRows, deleteOperatorAuditRows, insertAuditRowsAt } from './helpers';

// The audit helpers are the only test code that deletes or backdates audit
// rows (#186). With the maintenance switch on, a missing filter would delete
// every row on a shared branch, so they refuse instead.
describe('audit helpers fail closed', () => {
  it('deleteAuditRows refuses an empty list', async () => {
    await expect(deleteAuditRows([])).rejects.toThrow(/at least one tenant id/);
  });

  it('deleteAuditRows refuses an empty id', async () => {
    await expect(deleteAuditRows([''])).rejects.toThrow(/no empty ones/);
  });

  it('deleteOperatorAuditRows refuses an empty id', async () => {
    await expect(deleteOperatorAuditRows('')).rejects.toThrow(/operator id/);
  });

  it('insertAuditRowsAt refuses an empty list', async () => {
    await expect(insertAuditRowsAt([])).rejects.toThrow(/at least one row/);
  });
});
