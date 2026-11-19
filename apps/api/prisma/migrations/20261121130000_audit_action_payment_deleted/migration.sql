-- Annulling an encounter deletes its pending or waived payment, and the
-- payment gets an audit row of its own, naming it, in the annulment's
-- transaction. Until now the deletion was only a parameter of the
-- encounter's row.
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_DELETED';
