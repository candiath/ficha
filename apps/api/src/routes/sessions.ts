import { Router } from 'express';
import { z } from 'zod';
import { IdSchema } from '../lib/validation';
import { sessionDateField } from '../lib/sessionDate';
import {
  appointmentRepo,
  auditLogRepo,
  episodeRepo,
  packageRepo,
  patientRepo,
  sessionRepo,
} from '../repositories';

type ParentParams = { patientId: string };
type SessionParams = { patientId: string; sessionId: string };

// Montado en /api/patients/:patientId/sessions
// Las queries (incluida la transacción del POST) viven en sessionRepo; acá
// queda el HTTP: validar el body, exigir que paciente, episodios y paquete
// sean del tenant, y registrar auditoría.
const router = Router({ mergeParams: true });

// Base SIN defaults: es el que se deriva para el PATCH.
//
// Un .default() acá sobrevive al .partial() de abajo (Zod no lo anula), y en un
// update deja de significar "valor inicial si no lo mandás" para significar
// "pisá lo que había": un PATCH sin sessionType convertía un alta en sesión
// común, y uno sin episodeIds los desvinculaba todos (issue #97). Los defaults
// son del alta, así que viven solo en SessionCreateSchema.
const SessionFieldsSchema = z.object({
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']),
  sessionDate: sessionDateField,
  episodeIds: z.array(IdSchema),
  preSesionState: z.string().optional().nullable(),
  reEvaluationNotes: z.string().optional().nullable(),
  patientResponse: z.string().optional().nullable(),
  painScaleBefore: z.number().int().min(0).max(10).optional().nullable(),
  painScaleAfter: z.number().int().min(0).max(10).optional().nullable(),
  observations: z.string().optional().nullable(),
});

// El POST acepta además el cobro de la sesión para crear todo en una sola
// transacción. Antes el frontend encadenaba varios requests y un fallo
// intermedio dejaba sesiones sin pago (invisibles en Cobros).
const SessionCreateSchema = SessionFieldsSchema.extend({
  // Los defaults del alta: una sesión sin tipo es SESSION y puede no abordar
  // ningún episodio.
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']).default('SESSION'),
  episodeIds: z.array(IdSchema).optional().default([]),
  // El turno del que sale esta sesión, cuando se registra desde la agenda.
  // Va acá y no en un endpoint aparte para que sesión, cobro y vínculo se
  // creen en una sola transacción: encadenar requests es lo que dejaba
  // sesiones sin cobro antes (A3).
  appointmentId: IdSchema.optional().nullable(),
  payment: z
    .object({
      packageId: IdSchema.optional().nullable(),
      baseAmount: z.number().nonnegative(),
      discount: z.number().nonnegative().default(0),
      notes: z.string().optional().nullable(),
    })
    // Mismo invariante que POST /api/payments: un descuento mayor al monto
    // base deja finalAmount negativo, o sea un cobro que devuelve plata. Va
    // acá además de allá porque ésta es la vía por la que la app crea los
    // cobros de verdad — el alta de la sesión los trae embebidos (issue #73).
    .refine((d) => d.discount <= d.baseAmount, {
      error: 'El descuento no puede superar el monto base',
      path: ['discount'],
    })
    .optional(),
});

// payment queda afuera a propósito: el pago se edita por /api/payments.
const SessionUpdateSchema = SessionFieldsSchema.partial();

// GET /api/patients/:patientId/sessions
// Acepta ?episodeId= para filtrar por episodio (sesiones que abordaron ese motivo).
router.get<ParentParams>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;

  const sessions = await sessionRepo.listByPatient(req.context, req.params.patientId, {
    episodeId,
  });

  res.json({ data: sessions });
});

// GET /api/patients/:patientId/sessions/:sessionId
router.get<SessionParams>('/:sessionId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const session = await sessionRepo.getById(
    req.context,
    req.params.patientId,
    req.params.sessionId,
  );

  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  res.json({ data: session });
});

// POST /api/patients/:patientId/sessions
router.post<ParentParams>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const { episodeIds, payment, appointmentId, ...rest } = SessionCreateSchema.parse(req.body);

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

  // El turno tiene que ser de este paciente. Sin esto se podría registrar
  // la sesión de un paciente contra el turno de otro, y el turno ajeno
  // quedaría marcado como atendido.
  if (appointmentId) {
    const turno = await appointmentRepo.getById(req.context, appointmentId);
    if (!turno || turno.patientId !== req.params.patientId) {
      res.status(404).json({ error: 'Turno no encontrado' });
      return;
    }
  }

  // Sesión, cobro, cierre de episodios y vínculo con el turno se crean en una
  // sola transacción dentro del repo: si algo falla no queda una sesión a
  // medias.
  const result = await sessionRepo.create(req.context, req.params.patientId, {
    ...rest,
    sessionDate: new Date(rest.sessionDate),
    episodeIds,
    payment,
    appointmentId,
  });

  // El turno ya había producido su sesión: dos clicks en "registrar sesión",
  // o dos pestañas. La sesión no se creó, así que no hay nada que deshacer.
  if (!result.ok) {
    res.status(409).json({ error: 'Ese turno ya tiene una sesión registrada' });
    return;
  }

  const session = result.session;

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
      entity: 'SESSION',
      entityId: session.id,
      action: 'CREATED',
      description: `${sessionTypeDesc[rest.sessionType ?? 'SESSION'] ?? 'Sesión registrada'}${painSuffix}`,
    })
    .catch((err) => console.error('[audit]', err));

  res.status(201).json({ data: session });
});

// PATCH /api/patients/:patientId/sessions/:sessionId
router.patch<SessionParams>('/:sessionId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const { episodeIds, sessionDate, ...rest } = SessionUpdateSchema.parse(req.body);

  // !== undefined y no truthy: [] es un valor válido (desvincular todos los
  // episodios) y hay que distinguirlo de "el campo no vino".
  if (
    episodeIds !== undefined &&
    !(await episodeRepo.allBelongToPatient(req.context, req.params.patientId, episodeIds))
  ) {
    res.status(400).json({ error: 'Episodio inexistente o de otro paciente' });
    return;
  }

  // null = sesión inexistente o de otro paciente: mismo 404, sin revelar cuál.
  const session = await sessionRepo.update(
    req.context,
    req.params.patientId,
    req.params.sessionId,
    {
      ...rest,
      ...(sessionDate ? { sessionDate: new Date(sessionDate) } : {}),
      episodeIds,
    },
  );

  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      entity: 'SESSION',
      entityId: session.id,
      action: 'UPDATED',
      description: 'Sesión actualizada',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data: session });
});

// DELETE /api/patients/:patientId/sessions/:sessionId
// Borrado lógico, igual que pacientes: la sesión desaparece de los listados y
// de las métricas, pero la fila queda —para no romper el pivote con episodios
// ni la auditoría— y el borrado es reversible.
router.delete<SessionParams>('/:sessionId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const result = await sessionRepo.softDelete(
    req.context,
    req.params.patientId,
    req.params.sessionId,
  );

  // Inexistente, de otro paciente o ya borrada: mismo 404, sin revelar cuál.
  if (result === 'not_found') {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  // La sesión existe pero ya se cobró. Plata que entró de verdad no se hace
  // desaparecer borrando la sesión: primero se revierte el cobro, y entonces
  // sí se puede eliminar. Mismo criterio que el 409 de los paquetes en uso.
  if (result === 'paid') {
    res.status(409).json({
      error: 'La sesión tiene un cobro ya pagado. Revertí el cobro antes de eliminarla.',
    });
    return;
  }

  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      entity: 'SESSION',
      entityId: req.params.sessionId,
      action: 'DELETED',
      description: 'Sesión eliminada',
    })
    .catch((err) => console.error('[audit]', err));

  res.status(204).send();
});

export default router;
