import { Router } from 'express';
import { DEV_CONTEXT } from '../context/dev';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/sessions — todas las sesiones del tenant, con nombre del paciente
router.get('/', async (_req, res) => {
  const sessions = await prisma.session.findMany({
    where: { tenantId: DEV_CONTEXT.tenantId },
    orderBy: { sessionDate: 'desc' },
    select: {
      id: true,
      patientId: true,
      episodeId: true,
      sessionType: true,
      sessionDate: true,
      painScaleBefore: true,
      painScaleAfter: true,
      preSesionState: true,
      reEvaluationNotes: true,
      patientResponse: true,
      observations: true,
      createdAt: true,
      updatedAt: true,
      patient: {
        select: { id: true, fullName: true },
      },
      episode: {
        select: { id: true, mainComplaint: true },
      },
    },
  });

  res.json({ data: sessions });
});

export default router;
