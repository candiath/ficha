import type { Prisma } from '@prisma/client';
import { readAuditParams } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  RevisionDTO,
  RevisionRepository,
  RevisionSummaryDTO,
  RevisionTarget,
} from '../revisionRepository';

type Db = ReturnType<typeof forTenant>;

const auditSelect = {
  action: true,
  params: true,
  actorType: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
} as const;

const summarySelect = { version: true, auditLog: { select: auditSelect } } as const;
const fullSelect = { ...summarySelect, schemaVersion: true, snapshot: true, reasonNote: true } as const;

type SummaryRow = Prisma.SessionRevisionGetPayload<{ select: typeof summarySelect }>;
type FullRow = Prisma.SessionRevisionGetPayload<{ select: typeof fullSelect }>;

// The patient must exist and not be deleted, and the aggregate must be hers:
// one query each, with the condition in the where (CLAUDE.md, repositories).
const livePatient = { deletedAt: null } as const;

async function aggregateExists(db: Db, patientId: string, target: RevisionTarget): Promise<boolean> {
  const select = { id: true } as const;
  switch (target.aggregate) {
    case 'patient':
      return (await db.patient.findFirst({ where: { id: patientId, ...livePatient }, select })) !== null;
    case 'session':
      return (
        (await db.session.findFirst({ where: { id: target.sessionId, patientId, patient: livePatient }, select })) !==
        null
      );
    case 'episode':
      return (
        (await db.clinicalEpisode.findFirst({
          where: { id: target.episodeId, patientId, patient: livePatient },
          select,
        })) !== null
      );
    case 'evaluation':
      return (
        (await db.initialEvaluation.findFirst({
          where: { episodeId: target.episodeId, patientId, patient: livePatient },
          select,
        })) !== null
      );
    case 'consent':
      return (await db.informedConsent.findFirst({ where: { patientId, patient: livePatient }, select })) !== null;
    case 'patientEvent':
      return (
        (await db.patientEvent.findFirst({ where: { id: target.eventId, patientId, patient: livePatient }, select })) !==
        null
      );
  }
}

// The revisions of the aggregate, filtered by (tenant, patient, aggregate) in
// the where: forTenant adds the tenant. The six tables have the same columns
// but six delegates, which Prisma's types cannot unite: each is read through
// the one call this needs.
interface RevisionDelegate {
  findMany(args: { where: object; select: object; orderBy: { version: 'desc' } }): Promise<unknown[]>;
}

function revisions(db: Db, patientId: string, target: RevisionTarget): { delegate: RevisionDelegate; where: object } {
  const of = (delegate: unknown, where: object) => ({ delegate: delegate as RevisionDelegate, where: { patientId, ...where } });
  switch (target.aggregate) {
    case 'patient':
      return of(db.patientRevision, {});
    case 'session':
      return of(db.sessionRevision, { sessionId: target.sessionId });
    case 'episode':
      return of(db.episodeRevision, { episodeId: target.episodeId });
    case 'evaluation':
      return of(db.evaluationRevision, { evaluation: { episodeId: target.episodeId } });
    case 'consent':
      return of(db.consentRevision, {});
    case 'patientEvent':
      return of(db.patientEventRevision, { patientEventId: target.eventId });
  }
}

async function findRevisions<Row>(
  db: Db,
  patientId: string,
  target: RevisionTarget,
  select: object,
  version?: number,
): Promise<Row[]> {
  const { delegate, where } = revisions(db, patientId, target);
  const rows = await delegate.findMany({
    where: version === undefined ? where : { ...where, version },
    select,
    orderBy: { version: 'desc' },
  });
  return rows as Row[];
}

function toSummary(row: SummaryRow): RevisionSummaryDTO {
  const { auditLog } = row;
  return {
    version: row.version,
    action: auditLog.action,
    params: readAuditParams('audit_logs', auditLog.action, auditLog.params),
    actorType: auditLog.actorType,
    author: auditLog.user,
    createdAt: auditLog.createdAt.toISOString(),
  };
}

function toDTO(row: FullRow): RevisionDTO {
  return {
    ...toSummary(row),
    schemaVersion: row.schemaVersion,
    snapshot: row.snapshot,
    reasonNote: row.reasonNote,
  };
}

export const prismaRevisionRepository: RevisionRepository = {
  async list(ctx, patientId, target) {
    const db = forTenant(ctx);
    if (!(await aggregateExists(db, patientId, target))) return null;
    const rows = await findRevisions<SummaryRow>(db, patientId, target, summarySelect);
    return rows.map(toSummary);
  },

  async get(ctx: TenantContext, patientId: string, target: RevisionTarget, version: number) {
    const db = forTenant(ctx);
    if (!(await aggregateExists(db, patientId, target))) return { ok: false, reason: 'not_found' };
    const [row] = await findRevisions<FullRow>(db, patientId, target, fullSelect, version);
    if (!row) return { ok: false, reason: 'no_version' };
    return { ok: true, revision: toDTO(row) };
  },
};
