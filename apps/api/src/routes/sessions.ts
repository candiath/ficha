import { Router } from 'express';
import { z } from 'zod';
import { IdSchema, OptionalIdSchema, OptionalTextSchema } from '../lib/validation';
import { sessionDateField } from '../lib/clinicalDate';
import {
  appointmentRepo,
  episodeRepo,
  packageRepo,
  patientRepo,
  sessionRepo,
} from '../repositories';
import { idParam } from '../middlewares/idParam';

type ParentParams = { patientId: string };
type SessionParams = { patientId: string; sessionId: string };

// Montado en /api/patients/:patientId/sessions
// Las queries (incluida la transacción del POST) viven en sessionRepo; acá
// queda el HTTP: validar el body, exigir que paciente, episodios y paquete
// sean del tenant, y registrar auditoría.
const router = Router({ mergeParams: true });
router.param('sessionId', idParam('Sesión no encontrada'));

// Base SIN defaults: es el que se deriva para el PATCH.
//
// Un .default() acá sobrevive al .partial() de abajo (Zod no lo anula), y en un
// update deja de significar "valor inicial si no lo mandás" para significar
// "pisá lo que había": un PATCH sin sessionType convertía un alta en sesión
// común, y uno sin episodios los desvinculaba todos (issue #97). Los defaults
// son del alta, así que viven solo en SessionCreateSchema.

const painField = z.number().int().min(0).max(10).optional().nullable();

// A session can treat several episodes, one block each with everything
// clinical about that problem (#238). Which episodes a session may have (at
// least one; a discharge, exactly one) is the repository's rule.
const EpisodeBlockSchema = z.strictObject({
  episodeId: IdSchema,
  preSessionState: OptionalTextSchema,
  treatment: OptionalTextSchema,
  painScaleBefore: painField,
  painScaleAfter: painField,
  patientExercises: OptionalTextSchema,
  reEvaluationNotes: OptionalTextSchema,
});

const episodesField = z
  .array(EpisodeBlockSchema)
  .refine((blocks) => new Set(blocks.map((b) => b.episodeId)).size === blocks.length, {
    error: 'Un episodio aparece una sola vez en la sesión',
  });

// Strict: a field that is not the session's is a 400, not dropped in silence.
// A client still sending the pain at the top level, as before the blocks,
// would otherwise lose it without noticing.
const SessionFieldsSchema = z.strictObject({
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']),
  sessionDate: sessionDateField,
  episodes: episodesField,
  // The text of a note, which may belong to no episode.
  observations: OptionalTextSchema,
});

// El POST acepta además el cobro de la sesión para crear todo en una sola
// transacción. Antes el frontend encadenaba varios requests y un fallo
// intermedio dejaba sesiones sin pago (invisibles en Cobros).
const SessionCreateSchema = SessionFieldsSchema.extend({
  // Los defaults del alta: una sesión sin tipo es SESSION, y sin episodios
  // no aborda ninguno (válido solo para una nota).
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']).default('SESSION'),
  episodes: episodesField.optional().default([]),
  // El turno del que sale esta sesión, cuando se registra desde la agenda.
  // Va acá y no en un endpoint aparte para que sesión, cobro y vínculo se
  // creen en una sola transacción: encadenar requests es lo que dejaba
  // sesiones sin cobro antes (A3).
  appointmentId: IdSchema.optional().nullable(),
  payment: z
    .object({
      packageId: OptionalIdSchema,
      baseAmount: z.number().nonnegative(),
      discount: z.number().nonnegative().default(0),
      notes: OptionalTextSchema,
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

// payment queda afuera a propósito: el pago se edita por /api/payments. Un
// cliente que lo mande igual no rompe nada: se acepta y se descarta acá.
const SessionUpdateSchema = SessionFieldsSchema.partial()
  .extend({ payment: z.unknown().optional() })
  .transform(({ payment: _payment, ...fields }) => fields);

// A session, a clinical note and a discharge are three facts for the clinic,
// so three audit actions (SPEC-audit-structured-entries.md §1).
const RECORDED_ACTION = {
  SESSION: 'SESSION_RECORDED',
  NOTE: 'NOTE_RECORDED',
  DISCHARGE: 'DISCHARGE_RECORDED',
} as const;

const SessionFiltersSchema = z.object({ episodeId: IdSchema.optional() });

// The repository's rule on which episodes a session may have, in words.
const EPISODE_RULE_ERROR = {
  needs_episode: 'Una sesión aborda al menos un episodio',
  discharge_needs_one_episode: 'Un alta cierra exactamente un episodio',
} as const;

// GET /api/patients/:patientId/sessions
// Acepta ?episodeId= para filtrar por episodio (sesiones que abordaron ese motivo).
router.get<ParentParams>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const { episodeId } = SessionFiltersSchema.parse(req.query);

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

  const { episodes, payment, appointmentId, ...rest } = SessionCreateSchema.parse(req.body);

  // Los episodios vienen del body: sin esta verificación, una sesión podría
  // abordar episodios de otro paciente o de otro tenant. La base además lo
  // rechaza (las claves del bloque nombran clínica y paciente); esto da el 400.
  const episodeIds = episodes.map((b) => b.episodeId);
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
  const result = await sessionRepo.create(
    req.context,
    req.params.patientId,
    {
      ...rest,
      sessionDate: new Date(rest.sessionDate),
      episodes,
      payment,
      appointmentId,
    },
    (s) => ({
      action: RECORDED_ACTION[s.sessionType],
      patientId: req.params.patientId,
      entityId: s.id,
      params: {},
    }),
  );

  if (!result.ok) {
    // El turno ya había producido su sesión: dos clicks en "registrar sesión",
    // o dos pestañas. La sesión no se creó, así que no hay nada que deshacer.
    if (result.reason === 'appointment_taken') {
      res.status(409).json({ error: 'Ese turno ya tiene una sesión registrada' });
      return;
    }
    res.status(400).json({ error: EPISODE_RULE_ERROR[result.reason] });
    return;
  }

  res.status(201).json({ data: result.session });
});

// PATCH /api/patients/:patientId/sessions/:sessionId
router.patch<SessionParams>('/:sessionId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const { episodes, sessionDate, ...rest } = SessionUpdateSchema.parse(req.body);

  // !== undefined y no truthy: [] es un valor (una nota sin episodios) y hay
  // que distinguirlo de "el campo no vino".
  if (
    episodes !== undefined &&
    !(await episodeRepo.allBelongToPatient(
      req.context,
      req.params.patientId,
      episodes.map((b) => b.episodeId),
    ))
  ) {
    res.status(400).json({ error: 'Episodio inexistente o de otro paciente' });
    return;
  }

  const result = await sessionRepo.update(
    req.context,
    req.params.patientId,
    req.params.sessionId,
    {
      ...rest,
      ...(sessionDate ? { sessionDate: new Date(sessionDate) } : {}),
      episodes,
    },
    (s, changedFields) => ({
      action: 'SESSION_UPDATED',
      patientId: req.params.patientId,
      entityId: s.id,
      params: { sessionType: s.sessionType, changedFields },
    }),
  );

  if (!result.ok) {
    // Inexistente, borrada o de otro paciente: mismo 404, sin revelar cuál.
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Sesión no encontrada' });
      return;
    }
    res.status(400).json({ error: EPISODE_RULE_ERROR[result.reason] });
    return;
  }

  res.json({ data: result.session });
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
    {
      action: 'SESSION_DELETED',
      patientId: req.params.patientId,
      entityId: req.params.sessionId,
      params: {},
    },
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

  res.status(204).send();
});

export default router;
