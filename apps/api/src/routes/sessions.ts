import { Router } from 'express';
import { z } from 'zod';
import { sessionDateField } from '../lib/sessionDate';
import {
  auditLogRepo,
  episodeRepo,
  packageRepo,
  patientRepo,
  techniqueRepo,
} from '../repositories';

type ParentParams = { patientId: string };
type SessionParams = { patientId: string; sessionId: string };

// Montado en /api/patients/:patientId/sessions
const router = Router({ mergeParams: true });

// Una sesión puede abordar varios episodios (motivos) a la vez: se devuelven
// como episodeIds para que el cliente trabaje con un arreglo plano.
const sessionSelect = {
  id: true,
  patientId: true,
  sessionType: true,
  sessionDate: true,
  preSesionState: true,
  reEvaluationNotes: true,
  patientResponse: true,
  painScaleBefore: true,
  painScaleAfter: true,
  observations: true,
  createdAt: true,
  updatedAt: true,
  episodes: { select: { episodeId: true } },
} as const;

type SessionRow = {
  episodes: { episodeId: string }[];
  [key: string]: unknown;
};

// Aplana el pivote a un arreglo de ids de episodio.
function toSessionDTO({ episodes, ...rest }: SessionRow) {
  return { ...rest, episodeIds: episodes.map((e) => e.episodeId) };
}

const SessionFieldsSchema = z.object({
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']).default('SESSION'),
  sessionDate: sessionDateField,
  episodeIds: z.array(z.string().uuid()).optional().default([]),
  preSesionState: z.string().optional().nullable(),
  reEvaluationNotes: z.string().optional().nullable(),
  patientResponse: z.string().optional().nullable(),
  painScaleBefore: z.number().int().min(0).max(10).optional().nullable(),
  painScaleAfter: z.number().int().min(0).max(10).optional().nullable(),
  observations: z.string().optional().nullable(),
});

// El POST acepta además el cobro y las técnicas de la sesión para crear todo
// en una sola transacción. Antes el frontend encadenaba 3 requests y un fallo
// intermedio dejaba sesiones sin pago (invisibles en Cobros) o sin técnicas.
const SessionCreateSchema = SessionFieldsSchema.extend({
  payment: z
    .object({
      packageId: z.string().uuid().optional().nullable(),
      baseAmount: z.number().nonnegative(),
      discount: z.number().nonnegative().default(0),
      notes: z.string().optional().nullable(),
    })
    .optional(),
  techniques: z
    .array(
      z.object({
        techniqueId: z.string().uuid(),
        bodyRegionId: z.string().uuid().optional().nullable(),
        muscularChainId: z.string().uuid().optional().nullable(),
        variantNotes: z.string().optional().nullable(),
      }),
    )
    .optional()
    .default([]),
});

// payment/techniques quedan afuera a propósito: el pago se edita por
// /api/payments y las técnicas por el bulkReplace de /techniques.
const SessionUpdateSchema = SessionFieldsSchema.partial();

// GET /api/patients/:patientId/sessions
// Acepta ?episodeId= para filtrar por episodio (sesiones que abordaron ese motivo).
router.get<ParentParams>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;

  const sessions = await req.db.session.findMany({
    where: {
      patientId: req.params.patientId,
      ...(episodeId ? { episodes: { some: { episodeId } } } : {}),
    },
    orderBy: { sessionDate: 'desc' },
    select: sessionSelect,
  });

  res.json({ data: sessions.map(toSessionDTO) });
});

// GET /api/patients/:patientId/sessions/:sessionId
router.get<SessionParams>('/:sessionId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const session = await req.db.session.findFirst({
    where: {
      id: req.params.sessionId,
      patientId: req.params.patientId,
    },
    select: sessionSelect,
  });

  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  res.json({ data: toSessionDTO(session) });
});

// POST /api/patients/:patientId/sessions
router.post<ParentParams>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  // La sesión queda atribuida al usuario autenticado que la registra.
  const { userId } = req.context;
  const { episodeIds, payment, techniques, ...rest } = SessionCreateSchema.parse(req.body);

  // Los episodeIds vienen del body: sin esta verificación, un connect a
  // ciegas permitiría vincular la sesión a episodios de otro paciente o de
  // otro tenant (y GET /api/sessions expondría el mainComplaint ajeno).
  if (!(await episodeRepo.allBelongToPatient(req.context, req.params.patientId, episodeIds))) {
    res.status(400).json({ error: 'Episodio inexistente o de otro paciente' });
    return;
  }

  // El paquete a debitar debe ser del mismo tenant y del mismo paciente
  // (mismo criterio que POST /api/payments).
  if (
    payment?.packageId &&
    !(await packageRepo.belongsToPatient(req.context, payment.packageId, req.params.patientId))
  ) {
    res.status(404).json({ error: 'Paquete no encontrado' });
    return;
  }

  if (!(await techniqueRepo.allUsableByTenant(req.context, techniques.map((t) => t.techniqueId)))) {
    res.status(400).json({ error: 'Técnica inexistente' });
    return;
  }

  // Todo lo que dispara el registro de una sesión es atómico: si el pago,
  // las técnicas o el cierre de episodios fallan, no queda una sesión a
  // medias (sin pago no aparece en Cobros, y el reintento la duplicaba).
  //
  // Nota multi-tenant: el `tx` de una transacción interactiva NO está reescrito
  // por el tipo TenantScopedClient (igual que upsert; ver #55), así que sus
  // create/updateMany siguen exigiendo/aceptando tenantId a nivel de tipo. Lo
  // dejamos explícito: es lo que el tipo pide y, en el updateMany de episodios,
  // el filtro de seguridad real. En runtime el tx además arrastra la extension
  // (el objeto es el cliente extendido), como defensa en profundidad.
  const session = await req.db.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        ...rest,
        sessionDate: new Date(rest.sessionDate),
        patientId: req.params.patientId,
        tenantId: req.context.tenantId,
        userId,
        episodes: { create: episodeIds.map((episodeId) => ({ episode: { connect: { id: episodeId } } })) },
      },
      select: sessionSelect,
    });

    if (payment) {
      await tx.payment.create({
        data: {
          tenantId: req.context.tenantId,
          patientId: req.params.patientId,
          sessionId: created.id,
          packageId: payment.packageId ?? null,
          baseAmount: payment.baseAmount,
          discount: payment.discount,
          finalAmount: payment.baseAmount - payment.discount,
          notes: payment.notes ?? null,
        },
      });
    }

    if (techniques.length > 0) {
      await tx.sessionTechnique.createMany({
        data: techniques.map((t) => ({
          sessionId: created.id,
          techniqueId: t.techniqueId,
          bodyRegionId: t.bodyRegionId ?? null,
          muscularChainId: t.muscularChainId ?? null,
          variantNotes: t.variantNotes ?? null,
        })),
      });
    }

    // Cierre automático del/los episodio(s) al registrar alta. Dentro de la
    // transacción: antes era fire-and-forget y un fallo dejaba el alta
    // registrada con el episodio todavía abierto.
    if (rest.sessionType === 'DISCHARGE' && episodeIds.length > 0) {
      await tx.clinicalEpisode.updateMany({
        where: { id: { in: episodeIds }, tenantId: req.context.tenantId },
        data: { status: 'DISCHARGED', closedAt: new Date() },
      });
    }

    return created;
  });

  const sessionTypeDesc: Record<string, string> = {
    SESSION: 'Sesión RPG registrada',
    NOTE: 'Nota clínica registrada',
    DISCHARGE: 'Alta registrada',
  };
  const painSuffix =
    rest.painScaleBefore != null && rest.painScaleAfter != null
      ? ` — Dolor ${rest.painScaleBefore} → ${rest.painScaleAfter}`
      : '';
  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      userId,
      entity: 'SESSION',
      entityId: session.id,
      action: 'CREATED',
      description: `${sessionTypeDesc[rest.sessionType ?? 'SESSION'] ?? 'Sesión registrada'}${painSuffix}`,
    })
    .catch((err) => console.error('[audit]', err));

  res.status(201).json({ data: toSessionDTO(session) });
});

// PATCH /api/patients/:patientId/sessions/:sessionId
router.patch<SessionParams>('/:sessionId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const existing = await req.db.session.findFirst({
    where: {
      id: req.params.sessionId,
      patientId: req.params.patientId,
    },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  const { episodeIds, ...rest } = SessionUpdateSchema.parse(req.body);

  if (
    episodeIds &&
    !(await episodeRepo.allBelongToPatient(req.context, req.params.patientId, episodeIds))
  ) {
    res.status(400).json({ error: 'Episodio inexistente o de otro paciente' });
    return;
  }

  const session = await req.db.session.update({
    where: { id: req.params.sessionId },
    data: {
      ...rest,
      ...(rest.sessionDate ? { sessionDate: new Date(rest.sessionDate) } : {}),
      // Reemplaza el conjunto de episodios vinculados solo si se envía episodeIds.
      ...(episodeIds
        ? {
            episodes: {
              deleteMany: {},
              create: episodeIds.map((episodeId) => ({ episode: { connect: { id: episodeId } } })),
            },
          }
        : {}),
    },
    select: sessionSelect,
  });

  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      entity: 'SESSION',
      entityId: session.id,
      action: 'UPDATED',
      description: 'Sesión actualizada',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data: toSessionDTO(session) });
});

export default router;
