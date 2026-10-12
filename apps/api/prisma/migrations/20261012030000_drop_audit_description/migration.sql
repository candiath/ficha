-- Release 2 of audit rows as codes (#186, docs/specs/SPEC-audit-structured-entries.md):
-- the Spanish description is gone. Since release 1 no code writes it, and its
-- Prisma client never names it (@ignore), so this cannot break the code still
-- serving during the build.
--
-- On the DDL scan's allowlist (tests/auditMigrationScan.test.ts): dropping a
-- column of an audit table erases what its rows held. Allowed once, before the
-- pre-launch wipe (#223): every row with a description holds fictitious data.

LOCK TABLE public.audit_logs, public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "description";

-- AlterTable
ALTER TABLE "platform_audit_logs" DROP COLUMN "description";
