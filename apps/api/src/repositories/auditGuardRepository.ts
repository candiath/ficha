// The audit guarantees checked at API startup (#186,
// docs/specs/SPEC-audit-hardening.md §1 "Checks"): runs one of the SQL check
// files in prisma/ against the database. Like authRepository, it takes no ctx:
// it is about the database itself, not a clinic.

export type AuditGuardResult =
  | { status: 'passed' }
  // The check ran and found the guarantees changed.
  | { status: 'failed'; message: string }
  // The check could not run (a cold-start timeout, the database unreachable):
  // nothing is known, which is not the same as a failure.
  | { status: 'unreachable'; message: string };

export interface AuditGuardRepository {
  run(checkSql: string): Promise<AuditGuardResult>;
}
