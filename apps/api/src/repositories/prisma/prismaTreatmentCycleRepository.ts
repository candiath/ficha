import { prisma } from '../../lib/prisma';
import type { TenantContext } from '../types';
import type {
  TreatmentCycleCreateDTO,
  TreatmentCycleDTO,
  TreatmentCycleRepository,
  TreatmentCycleUpdateDTO,
} from '../treatmentCycleRepository';

const cycleSelect = {
  id: true,
  patientId: true,
  episodeId: true,
  name: true,
  mainChainId: true,
  objective: true,
  targetSessions: true,
  reevalEvery: true,
  dischargeCriteria: true,
  status: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  mainChain: { select: { name: true } },
} as const;

function toDTO(row: {
  id: string;
  patientId: string;
  episodeId: string | null;
  name: string;
  mainChainId: string | null;
  objective: string | null;
  targetSessions: number | null;
  reevalEvery: number | null;
  dischargeCriteria: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED';
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  mainChain: { name: string } | null;
}): TreatmentCycleDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    episodeId: row.episodeId,
    name: row.name,
    mainChainId: row.mainChainId,
    mainChainName: row.mainChain?.name ?? null,
    objective: row.objective,
    targetSessions: row.targetSessions,
    reevalEvery: row.reevalEvery,
    dischargeCriteria: row.dischargeCriteria,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function verifyPatient(ctx: TenantContext, patientId: string) {
  return prisma.patient.findFirst({
    where: { id: patientId, tenantId: ctx.tenantId },
    select: { id: true },
  });
}

export const prismaTreatmentCycleRepository: TreatmentCycleRepository = {
  async list(ctx, patientId, episodeId?: string) {
    const patient = await verifyPatient(ctx, patientId);
    if (!patient) return [];

    const rows = await prisma.treatmentCycle.findMany({
      where: {
        patientId,
        tenantId: ctx.tenantId,
        ...(episodeId ? { episodeId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      select: cycleSelect,
    });
    return rows.map(toDTO);
  },

  async create(ctx, patientId, data: TreatmentCycleCreateDTO) {
    const row = await prisma.treatmentCycle.create({
      data: {
        tenantId: ctx.tenantId,
        patientId,
        episodeId: data.episodeId ?? null,
        name: data.name,
        mainChainId: data.mainChainId ?? null,
        objective: data.objective ?? null,
        targetSessions: data.targetSessions ?? null,
        reevalEvery: data.reevalEvery ?? null,
        dischargeCriteria: data.dischargeCriteria ?? null,
        startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
      },
      select: cycleSelect,
    });
    return toDTO(row);
  },

  async update(ctx, patientId, cycleId, data: TreatmentCycleUpdateDTO) {
    const existing = await prisma.treatmentCycle.findFirst({
      where: { id: cycleId, patientId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!existing) return null;

    const row = await prisma.treatmentCycle.update({
      where: { id: cycleId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.mainChainId !== undefined && { mainChainId: data.mainChainId }),
        ...(data.objective !== undefined && { objective: data.objective }),
        ...(data.targetSessions !== undefined && { targetSessions: data.targetSessions }),
        ...(data.reevalEvery !== undefined && { reevalEvery: data.reevalEvery }),
        ...(data.dischargeCriteria !== undefined && { dischargeCriteria: data.dischargeCriteria }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.completedAt !== undefined && {
          completedAt: data.completedAt ? new Date(data.completedAt) : null,
        }),
      },
      select: cycleSelect,
    });
    return toDTO(row);
  },

  async delete(ctx, patientId, cycleId) {
    const existing = await prisma.treatmentCycle.findFirst({
      where: { id: cycleId, patientId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!existing) return false;

    await prisma.treatmentCycle.delete({ where: { id: cycleId } });
    return true;
  },
};
