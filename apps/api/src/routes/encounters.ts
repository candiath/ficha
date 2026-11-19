import { Router } from 'express';
import { z } from 'zod';
import { revisionReasonFields, revisionReasonSchema } from '@ficha/shared';
import { ExpectedVersionSchema, STALE_EDIT } from '../lib/staleEdit';
import { CentsSchema, IdSchema, OptionalIdSchema, OptionalTextSchema } from '../lib/validation';
import { encounterDateField } from '../lib/clinicalDate';
import {
  appointmentRepo,
  episodeRepo,
  packageRepo,
  encounterRepo,
} from '../repositories';
import { idParam } from '../middlewares/idParam';
import { revisionRoutes } from './revisions';

type ParentParams = { patientId: string };
type EncounterParams = { patientId: string; encounterId: string };

// Montado en /api/patients/:patientId/encounters
// Las queries (incluida la transacción del POST) viven en encounterRepo; acá
// queda el HTTP: validar el body, exigir que paciente, episodios y paquete
// sean del tenant, y registrar auditoría.
const router = Router({ mergeParams: true });
router.param('encounterId', idParam('Sesión no encontrada'));

// Base SIN defaults: es el que se deriva para el PATCH.
//
// Un .default() acá sobrevive al .partial() de abajo (Zod no lo anula), y en un
// update deja de significar "valor inicial si no lo mandás" para significar
// "pisá lo que había": un PATCH sin encounterType convertía un alta en sesión
// común, y uno sin episodios los desvinculaba todos (issue #97). Los defaults
// son del alta, así que viven solo en EncounterCreateSchema.

const painField = z.number().int().min(0).max(10).optional().nullable();

// An encounter can treat several episodes, one block each with everything
// clinical about that problem (#238). Which episodes an encounter may have (at
// least one; a discharge, exactly one) is the repository's rule.
const EpisodeBlockSchema = z.strictObject({
  episodeId: IdSchema,
  preEncounterState: OptionalTextSchema,
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

// Strict: a field that is not the encounter's is a 400, not dropped in silence.
// A client still sending the pain at the top level, as before the blocks,
// would otherwise lose it without noticing.
const EncounterFieldsSchema = z.strictObject({
  encounterType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']),
  encounterDate: encounterDateField,
  episodes: episodesField,
  // The text of a note, which may belong to no episode.
  observations: OptionalTextSchema,
});

// El POST acepta además el cobro de la sesión para crear todo en una sola
// transacción. Antes el frontend encadenaba varios requests y un fallo
// intermedio dejaba sesiones sin pago (invisibles en Cobros).
const EncounterCreateSchema = EncounterFieldsSchema.extend({
  // Los defaults del alta: una sesión sin tipo es SESSION, y sin episodios
  // no aborda ninguno (válido solo para una nota).
  encounterType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']).default('SESSION'),
  episodes: episodesField.optional().default([]),
  // El turno del que sale esta sesión, cuando se registra desde la agenda.
  // Va acá y no en un endpoint aparte para que sesión, cobro y vínculo se
  // creen en una sola transacción: encadenar requests es lo que dejaba
  // sesiones sin cobro antes (A3).
  appointmentId: IdSchema.optional().nullable(),
  payment: z
    .object({
      packageId: OptionalIdSchema,
      baseAmountCents: CentsSchema,
      discountCents: CentsSchema.default(0),
      notes: OptionalTextSchema,
    })
    // Mismo invariante que POST /api/payments: un descuento mayor al monto
    // base deja finalAmountCents negativo, o sea un cobro que devuelve plata. Va
    // acá además de allá porque ésta es la vía por la que la app crea los
    // cobros de verdad — el alta de la sesión los trae embebidos (issue #73).
    .refine((d) => d.discountCents <= d.baseAmountCents, {
      error: 'El descuento no puede superar el monto base',
      path: ['discountCents'],
    })
    .optional(),
});

// payment queda afuera a propósito: el pago se edita por /api/payments. Un
// cliente que lo mande igual no rompe nada: se acepta y se descarta acá.
//
// An edit is a correction of the record: it says why (SPEC-clinical-revisions.md
// §4), and which version it was made over, so a stale form gets a 409.
const EncounterUpdateSchema = EncounterFieldsSchema.partial()
  .extend({
    payment: z.unknown().optional(),
    expectedVersion: ExpectedVersionSchema,
    ...revisionReasonFields,
  })
  .transform(({ payment: _payment, ...fields }) => fields);

// An encounter, a clinical note and a discharge are three facts for the clinic,
// so three audit actions (SPEC-audit-structured-entries.md §1).
const RECORDED_ACTION = {
  SESSION: 'ENCOUNTER_RECORDED',
  NOTE: 'NOTE_RECORDED',
  DISCHARGE: 'DISCHARGE_RECORDED',
} as const;

const EncounterFiltersSchema = z.object({ episodeId: IdSchema.optional() });

// The repository's rule on which episodes an encounter may have, in words.
const EPISODE_RULE_ERROR = {
  needs_episode: 'Una sesión aborda al menos un episodio',
  discharge_needs_one_episode: 'Un alta cierra exactamente un episodio',
} as const;

// GET /api/patients/:patientId/encounters
// Acepta ?episodeId= para filtrar por episodio (sesiones que abordaron ese motivo).
router.get<ParentParams>('/', async (req, res) => {
  const { episodeId } = EncounterFiltersSchema.parse(req.query);

  const encounters = await encounterRepo.listByPatient(req.context, req.params.patientId, {
    episodeId,
  });

  res.json({ data: encounters });
});

// GET /api/patients/:patientId/encounters/:encounterId
router.get<EncounterParams>('/:encounterId', async (req, res) => {
  const encounter = await encounterRepo.getById(
    req.context,
    req.params.patientId,
    req.params.encounterId,
  );

  if (!encounter) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  res.json({ data: encounter });
});

// POST /api/patients/:patientId/encounters
router.post<ParentParams>('/', async (req, res) => {
  const { episodes, payment, appointmentId, ...rest } = EncounterCreateSchema.parse(req.body);

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
  const result = await encounterRepo.create(
    req.context,
    req.params.patientId,
    {
      ...rest,
      encounterDate: new Date(rest.encounterDate),
      episodes,
      payment,
      appointmentId,
    },
    (s) => ({
      action: RECORDED_ACTION[s.encounterType],
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
    if (result.reason === 'discharge_before_opening') {
      res.status(400).json({ error: 'El episodio abre más adelante: no se puede dar de alta antes de su apertura' });
      return;
    }
    res.status(400).json({ error: EPISODE_RULE_ERROR[result.reason] });
    return;
  }

  res.status(201).json({ data: result.encounter });
});

// PATCH /api/patients/:patientId/encounters/:encounterId
router.patch<EncounterParams>('/:encounterId', async (req, res) => {
  const { episodes, encounterDate, reason, ...rest } = EncounterUpdateSchema.parse(req.body);

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

  const result = await encounterRepo.update(
    req.context,
    req.params.patientId,
    req.params.encounterId,
    {
      ...rest,
      ...(encounterDate ? { encounterDate: new Date(encounterDate) } : {}),
      episodes,
    },
    (s, changedFields) => ({
      action: 'ENCOUNTER_UPDATED',
      patientId: req.params.patientId,
      entityId: s.id,
      params: { encounterType: s.encounterType, changedFields, reason },
    }),
  );

  if (!result.ok) {
    // Inexistente, borrada o de otro paciente: mismo 404, sin revelar cuál.
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Sesión no encontrada' });
      return;
    }
    if (result.reason === 'stale') {
      res.status(409).json(STALE_EDIT);
      return;
    }
    res.status(400).json({ error: EPISODE_RULE_ERROR[result.reason] });
    return;
  }

  res.json({ data: result.encounter });
});

// POST /api/patients/:patientId/encounters/:encounterId/annul
// An encounter entered by mistake is annulled, never deleted
// (SPEC-clinical-revisions.md §8): it stays in the record struck through, with
// its content in its history, and leaves the lists and the metrics. The reason
// is required, like every correction's. There is no restore route yet.
router.post<EncounterParams>('/:encounterId/annul', async (req, res) => {
  const { reason, reasonNote } = revisionReasonSchema.parse(req.body);

  const result = await encounterRepo.annul(
    req.context,
    req.params.patientId,
    req.params.encounterId,
    { reasonNote },
    (s) => ({
      action: 'ENCOUNTER_ANNULLED',
      patientId: req.params.patientId,
      entityId: s.id,
      params: { encounterType: s.encounterType, reason },
    }),
  );

  // Inexistente, de otro paciente o ya anulada: mismo 404, sin revelar cuál.
  if (result === 'not_found') {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  // La sesión existe pero ya se cobró. Plata que entró de verdad no se hace
  // desaparecer anulando la sesión: primero se revierte el cobro, y entonces
  // sí se puede anular. Mismo criterio que el 409 de los paquetes en uso.
  if (result === 'paid') {
    res.status(409).json({
      error: 'La sesión tiene un cobro ya pagado. Revertí el cobro antes de anularla.',
    });
    return;
  }

  res.status(204).send();
});

// Its history (SPEC-clinical-revisions.md §7).
router.use('/:encounterId/revisions', revisionRoutes((p) => ({ aggregate: 'encounter', encounterId: p.encounterId }), 'Sesión no encontrada'));

export default router;
